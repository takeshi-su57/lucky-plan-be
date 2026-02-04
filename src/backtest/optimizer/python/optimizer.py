#!/usr/bin/env python3
"""
Optuna-based Multi-Objective Parameter Optimizer

This optimizer integrates with the NestJS backtest module via HTTP API.
When spawned by BacktestRunnerService, it:
  1. Receives task configuration via CLI arguments
  2. Calls POST /backtest/run-single for each trial
  3. Stores Optuna study in PostgreSQL database
  4. Calls POST /backtest/task/:id/complete or /fail when done

The config JSON parameters can be:
  - Fixed values (number, boolean) - used as-is
  - Range objects {"min": x, "max": y} - becomes suggest_int or suggest_float
  - Arrays [1, 2, 3] or [true, false] - becomes suggest_categorical

Score calculation and normalization are handled server-side by NestJS.
All scores are pre-normalized so maximize is always the goal.

Usage (spawned by NestJS):
    python optimizer.py \
        --task-id <uuid> \
        --config '<inline JSON>' \
        --symbol BTCUSDT \
        --from 2023-01-01 \
        --to 2024-01-01 \
        --api-url http://localhost:3000 \
        --interval 1m \
        --metrics '["sharpeRatio", "maxDrawdownPercent"]' \
        --trials 100 \
        --postgres-url postgresql://user:pass@localhost/optuna_db
"""

import argparse
import json
import os
import sys
import copy
import uuid
import threading
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from typing import Any, Dict, List, Optional, Tuple, Union

import optuna
from optuna.trial import Trial


# Internal API secret for authentication (passed via environment variable)
INTERNAL_SECRET = os.environ.get("BACKTEST_INTERNAL_SECRET", "")


def get_api_headers() -> Dict[str, str]:
    """Get headers for internal API requests including the secret."""
    headers = {"Content-Type": "application/json"}
    if INTERNAL_SECRET:
        headers["X-Internal-Secret"] = INTERNAL_SECRET
    return headers


# ==================== HTTP SESSION WITH RETRY ====================

def create_retry_session(
    retries: int = 5,
    backoff_factor: float = 1.0,
    status_forcelist: Tuple[int, ...] = (500, 502, 503, 504),
) -> requests.Session:
    """
    Create a requests session with retry logic and exponential backoff.

    Args:
        retries: Number of retry attempts (default: 5)
        backoff_factor: Exponential backoff multiplier (default: 1.0)
            Delays: 1s, 2s, 4s, 8s, 16s
        status_forcelist: HTTP status codes that trigger retry

    Returns:
        Configured requests.Session with retry adapter
    """
    session = requests.Session()

    retry_strategy = Retry(
        total=retries,
        backoff_factor=backoff_factor,
        status_forcelist=status_forcelist,
        allowed_methods=["GET", "POST"],  # Retry on both GET and POST
        raise_on_status=False,  # Don't raise, let us handle response
    )

    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("http://", adapter)
    session.mount("https://", adapter)

    return session


# Global session with retry logic
_http_session: Optional[requests.Session] = None


def get_http_session() -> requests.Session:
    """Get or create the global HTTP session with retry logic."""
    global _http_session
    if _http_session is None:
        _http_session = create_retry_session()
    return _http_session


# ==================== HEARTBEAT MANAGER ====================

class HeartbeatManager:
    """
    Background thread manager for sending heartbeats to NestJS.

    Features:
    - Sends heartbeat every 10 seconds
    - Detects task cancellation via heartbeat response
    - Handles reconnection after NestJS restart
    - Thread-safe trial progress updates
    """

    HEARTBEAT_INTERVAL = 10  # seconds
    MAX_CONSECUTIVE_FAILURES = 3  # Trigger reconnect after this many failures

    def __init__(self, api_url: str, task_id: str):
        self.api_url = api_url
        self.task_id = task_id
        self._current_trial = 0
        self._trial_progress = "sampling"
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._cancelled = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._consecutive_failures = 0
        self._session = get_http_session()

    def start(self) -> None:
        """Start the heartbeat background thread."""
        if self._thread is not None:
            return

        self._stop_event.clear()
        self._cancelled.clear()
        self._thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self._thread.start()
        print(f"[Heartbeat] Started for task {self.task_id}", file=sys.stderr)

    def stop(self) -> None:
        """Stop the heartbeat background thread."""
        self._stop_event.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None
        print(f"[Heartbeat] Stopped for task {self.task_id}", file=sys.stderr)

    def update_progress(self, trial_number: int, progress: str = "sampling") -> None:
        """
        Thread-safe update of trial progress.

        Args:
            trial_number: Current trial number (0-indexed)
            progress: Trial phase - "sampling", "evaluating", or "completed"
        """
        with self._lock:
            self._current_trial = trial_number
            self._trial_progress = progress

    def is_cancelled(self) -> bool:
        """Check if task has been cancelled (detected via heartbeat response)."""
        return self._cancelled.is_set()

    def _heartbeat_loop(self) -> None:
        """Background loop that sends periodic heartbeats."""
        while not self._stop_event.wait(timeout=self.HEARTBEAT_INTERVAL):
            try:
                success = self._send_heartbeat()

                if success:
                    self._consecutive_failures = 0
                else:
                    self._consecutive_failures += 1

                    if self._consecutive_failures >= self.MAX_CONSECUTIVE_FAILURES:
                        print(
                            f"[Heartbeat] {self._consecutive_failures} consecutive failures, "
                            "attempting reconnection...",
                            file=sys.stderr
                        )
                        if self._attempt_reconnect():
                            self._consecutive_failures = 0
                        else:
                            print("[Heartbeat] Reconnection failed", file=sys.stderr)

            except Exception as e:
                print(f"[Heartbeat] Error: {e}", file=sys.stderr)
                self._consecutive_failures += 1

    def _send_heartbeat(self) -> bool:
        """
        Send a single heartbeat to NestJS.

        Returns:
            True if heartbeat succeeded, False otherwise
        """
        with self._lock:
            current_trial = self._current_trial
            trial_progress = self._trial_progress

        try:
            response = self._session.post(
                f"{self.api_url}/backtest/task/{self.task_id}/heartbeat",
                json={
                    "currentTrial": current_trial,
                    "trialProgress": trial_progress,
                },
                headers=get_api_headers(),
                timeout=10,
            )

            if not response.ok:
                print(
                    f"[Heartbeat] HTTP {response.status_code}: {response.text[:100]}",
                    file=sys.stderr
                )
                return False

            data = response.json()

            # Check for cancellation in response
            status = data.get("status", "")
            if status == "CANCELLED":
                print("[Heartbeat] Task cancelled by server", file=sys.stderr)
                self._cancelled.set()

            return data.get("success", False)

        except requests.Timeout:
            print("[Heartbeat] Timeout", file=sys.stderr)
            return False
        except requests.RequestException as e:
            print(f"[Heartbeat] Request failed: {e}", file=sys.stderr)
            return False

    def _attempt_reconnect(self) -> bool:
        """
        Attempt to reconnect after NestJS may have restarted.

        Returns:
            True if reconnection successful and should continue, False otherwise
        """
        try:
            response = self._session.get(
                f"{self.api_url}/backtest/task/{self.task_id}/reconnect",
                headers=get_api_headers(),
                timeout=15,
            )

            if not response.ok:
                print(
                    f"[Heartbeat] Reconnect HTTP {response.status_code}",
                    file=sys.stderr
                )
                return False

            data = response.json()

            if not data.get("shouldContinue", False):
                status = data.get("status", "unknown")
                print(
                    f"[Heartbeat] Server says stop (status={status})",
                    file=sys.stderr
                )
                self._cancelled.set()
                return False

            print(
                f"[Heartbeat] Reconnected successfully "
                f"(processed={data.get('processedConfigs', 0)}/{data.get('totalConfigs', 0)})",
                file=sys.stderr
            )
            return True

        except requests.RequestException as e:
            print(f"[Heartbeat] Reconnect request failed: {e}", file=sys.stderr)
            return False


# Global heartbeat manager instance
_heartbeat_manager: Optional[HeartbeatManager] = None


def get_heartbeat_manager() -> Optional[HeartbeatManager]:
    """Get the global heartbeat manager instance."""
    return _heartbeat_manager


def start_heartbeat_manager(api_url: str, task_id: str) -> HeartbeatManager:
    """Create and start the global heartbeat manager."""
    global _heartbeat_manager
    _heartbeat_manager = HeartbeatManager(api_url, task_id)
    _heartbeat_manager.start()
    return _heartbeat_manager


def stop_heartbeat_manager() -> None:
    """Stop the global heartbeat manager."""
    global _heartbeat_manager
    if _heartbeat_manager is not None:
        _heartbeat_manager.stop()
        _heartbeat_manager = None


# ==================== STORAGE ====================

def sanitize_postgres_url(url: str) -> str:
    """
    Remove unsupported parameters from PostgreSQL URL.
    Prisma uses ?schema=xxx which psycopg2 doesn't support.
    """
    from urllib.parse import urlparse, parse_qs, urlencode, urlunparse

    parsed = urlparse(url)
    if parsed.query:
        # Parse query params and remove unsupported ones
        params = parse_qs(parsed.query)
        unsupported = ['schema']
        for key in unsupported:
            params.pop(key, None)
        # Rebuild URL without unsupported params
        new_query = urlencode(params, doseq=True)
        parsed = parsed._replace(query=new_query)

    return urlunparse(parsed)


def get_study_storage(postgres_url: str):
    """
    Return PostgreSQL storage for Optuna study.
    Optuna auto-creates tables on first use.
    """
    # Sanitize URL to remove unsupported params like ?schema=
    clean_url = sanitize_postgres_url(postgres_url)

    return optuna.storages.RDBStorage(
        url=clean_url,
        heartbeat_interval=60,
        grace_period=120,
        failed_trial_callback=optuna.storages.RetryFailedTrialCallback(max_retry=3),
        engine_kwargs={
            "pool_size": 5,
            "pool_pre_ping": True,
            "pool_recycle": 3600,
        },
    )


def get_study_name(task_id: str) -> str:
    """Generate unique study name from task ID."""
    return f"task-{task_id}"


# ==================== API INTEGRATION ====================

def run_backtest_via_api(
    api_url: str,
    task_id: str,
    config_id: str,
    strategy_config: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Call the NestJS run-single endpoint to execute a backtest.
    Uses retry session for resilience against network issues.
    Returns the response with score and metrics.
    """
    session = get_http_session()

    try:
        response = session.post(
            f"{api_url}/backtest/run-single",
            json={
                "taskId": task_id,
                "configId": config_id,
                "strategyConfig": strategy_config,
            },
            headers=get_api_headers(),
            timeout=300,
        )
        if not response.ok:
            return {"success": False, "error": f"HTTP {response.status_code}: {response.text[:200]}"}
        return response.json()
    except requests.Timeout:
        return {"success": False, "error": "Backtest timed out"}
    except requests.RequestException as e:
        return {"success": False, "error": f"API request failed: {e}"}
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"Failed to parse API response: {e}"}


def complete_task(api_url: str, task_id: str, best_config_ids: List[str]) -> None:
    """Notify NestJS with Pareto-optimal config IDs. Uses retry session."""
    session = get_http_session()

    try:
        response = session.post(
            f"{api_url}/backtest/task/{task_id}/complete",
            json={
                "bestConfigIds": best_config_ids,
            },
            headers=get_api_headers(),
            timeout=30,
        )
        if not response.ok:
            print(f"Warning: Task completion returned HTTP {response.status_code}", file=sys.stderr)
    except requests.RequestException as e:
        print(f"Warning: Failed to notify task completion: {e}", file=sys.stderr)


def fail_task(api_url: str, task_id: str, error: str) -> None:
    """Notify NestJS that optimization failed. Uses retry session."""
    session = get_http_session()

    try:
        response = session.post(
            f"{api_url}/backtest/task/{task_id}/fail",
            json={"error": error},
            headers=get_api_headers(),
            timeout=30,
        )
        if not response.ok:
            print(f"Warning: Task failure notification returned HTTP {response.status_code}", file=sys.stderr)
    except requests.RequestException as e:
        print(f"Warning: Failed to notify task failure: {e}", file=sys.stderr)


def is_task_cancelled(api_url: str, task_id: str) -> bool:
    """
    Check if task has been cancelled.
    First checks the heartbeat manager (faster), then falls back to API call.
    """
    # Check heartbeat manager first (no network call)
    hb = get_heartbeat_manager()
    if hb is not None and hb.is_cancelled():
        return True

    # Fall back to API call
    session = get_http_session()

    try:
        response = session.get(
            f"{api_url}/backtest/task/{task_id}/cancelled",
            headers=get_api_headers(),
            timeout=10,
        )
        if not response.ok:
            return False
        data = response.json()
        return data.get("cancelled", False)
    except requests.RequestException:
        return False


# ==================== PARAMETER HANDLING ====================

ParamValue = Union[int, float, bool, Dict[str, Any], List[Any]]


def is_range_param(value: Any) -> bool:
    """Check if a value is a range object {"min": x, "max": y}"""
    return (
        isinstance(value, dict) and
        "min" in value and
        "max" in value and
        len(value) == 2
    )


def is_categorical_param(value: Any) -> bool:
    """Check if a value is a categorical array [val1, val2, ...]"""
    if not isinstance(value, list) or len(value) == 0:
        return False
    for item in value:
        if isinstance(item, dict):
            return False
        if not isinstance(item, (int, float, bool, str)):
            return False
    return True


def detect_param_type(value: Any) -> str:
    """Detect the parameter type for Optuna."""
    if is_range_param(value):
        if isinstance(value["min"], float) or isinstance(value["max"], float):
            return "float"
        return "int"
    elif is_categorical_param(value):
        return "categorical"
    else:
        return "fixed"


def extract_optimizable_params(
    factory_config: Dict[str, Any],
    path: str = ""
) -> List[Tuple[str, str, Any]]:
    """Recursively extract all optimizable parameters from the factory config."""
    params = []
    for key, value in factory_config.items():
        current_path = f"{path}.{key}" if path else key
        if is_range_param(value) or is_categorical_param(value):
            param_type = detect_param_type(value)
            params.append((current_path, param_type, value))
        elif isinstance(value, dict):
            params.extend(extract_optimizable_params(value, current_path))
        elif isinstance(value, list):
            for i, item in enumerate(value):
                if isinstance(item, dict):
                    params.extend(extract_optimizable_params(item, f"{current_path}[{i}]"))
    return params


def suggest_param(trial: Trial, param_path: str, param_type: str, param_value: Any) -> Any:
    """Use Optuna trial to suggest a value for the parameter."""
    param_name = param_path.replace(".", "_").replace("[", "_").replace("]", "")
    if param_type == "int":
        return trial.suggest_int(param_name, param_value["min"], param_value["max"])
    elif param_type == "float":
        return trial.suggest_float(param_name, param_value["min"], param_value["max"])
    elif param_type == "categorical":
        return trial.suggest_categorical(param_name, param_value)
    else:
        return param_value


def set_nested_value(config: Dict[str, Any], path: str, value: Any) -> None:
    """Set a value in a nested dict using dot notation path."""
    parts = []
    current = ""
    i = 0
    while i < len(path):
        if path[i] == ".":
            if current:
                parts.append(current)
            current = ""
        elif path[i] == "[":
            if current:
                parts.append(current)
            current = ""
            j = i + 1
            while j < len(path) and path[j] != "]":
                j += 1
            parts.append(int(path[i+1:j]))
            i = j
        else:
            current += path[i]
        i += 1
    if current:
        parts.append(current)

    obj = config
    for part in parts[:-1]:
        obj = obj[part]
    obj[parts[-1]] = value


def build_config_from_trial(
    factory_config: Dict[str, Any],
    optimizable_params: List[Tuple[str, str, Any]],
    trial: Trial
) -> Dict[str, Any]:
    """Build a concrete StrategyConfig from the factory config by sampling values."""
    config = copy.deepcopy(factory_config)
    for param_path, param_type, param_value in optimizable_params:
        sampled_value = suggest_param(trial, param_path, param_type, param_value)
        set_nested_value(config, param_path, sampled_value)
    return config


# ==================== OBJECTIVE FUNCTION ====================

def create_objective(
    api_url: str,
    task_id: str,
    factory_config: Dict[str, Any],
    optimizable_params: List[Tuple[str, str, Any]],
    num_objectives: int,
    check_interval: int = 10,
):
    """
    Create a multi-objective Optuna objective function.
    Scores are pre-normalized by NestJS (all maximize).
    Updates heartbeat manager with trial progress.
    Returns list of scores for multi-objective, single float for single-objective.
    """
    trial_count = 0

    def objective(trial: Trial) -> Union[float, List[float]]:
        nonlocal trial_count
        trial_count += 1

        # Update heartbeat manager with current trial (sampling phase)
        hb = get_heartbeat_manager()
        if hb is not None:
            hb.update_progress(trial.number, "sampling")

            # Check for cancellation via heartbeat manager (faster than API call)
            if hb.is_cancelled():
                raise optuna.TrialPruned("Task was cancelled")

        # Also check cancellation via API every N trials (belt and suspenders)
        if trial_count % check_interval == 0:
            if is_task_cancelled(api_url, task_id):
                raise optuna.TrialPruned("Task was cancelled")

        # Build concrete config from trial
        config = build_config_from_trial(factory_config, optimizable_params, trial)

        # Generate unique config ID and store in trial for later retrieval
        config_id = str(uuid.uuid4())
        trial.set_user_attr("config_id", config_id)

        # Update progress to evaluating phase
        if hb is not None:
            hb.update_progress(trial.number, "evaluating")

        # Call API
        result = run_backtest_via_api(api_url, task_id, config_id, config)

        if not result.get("success"):
            print(f"  [FAILED] {result.get('error', 'Unknown error')}", file=sys.stderr)
            # Return worst scores (all maximize, so -inf is worst)
            if num_objectives == 1:
                return float("-inf")
            return [float("-inf")] * num_objectives

        # Get pre-normalized scores from API
        scores = result.get("scores") or []
        metrics = result.get("metrics") or {}

        # Print progress
        print(
            f"  Trial {trial.number}: scores={scores}, "
            f"trades={metrics.get('totalTrades', 0)}, "
            f"pnl={metrics.get('totalPnlPercent', 0) or 0:.1f}%",
            file=sys.stderr
        )

        # Mark trial as completed in heartbeat
        if hb is not None:
            hb.update_progress(trial.number, "completed")

        # Return single value or list based on number of objectives
        if num_objectives == 1:
            return scores[0] if scores else float("-inf")
        return scores if len(scores) == num_objectives else [float("-inf")] * num_objectives

    return objective


# ==================== CLI ====================

def parse_args():
    parser = argparse.ArgumentParser(
        description="Optuna-based parameter optimizer (PostgreSQL storage)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Required arguments
    parser.add_argument("--task-id", required=True,
                       help="BacktestTask ID (spawned by NestJS)")
    parser.add_argument("--config", required=True,
                       help="Inline JSON config")
    parser.add_argument("--symbol", required=True,
                       help="Trading symbol")
    parser.add_argument("--from", dest="from_date", required=True,
                       help="Start date (YYYY-MM-DD)")
    parser.add_argument("--to", dest="to_date", required=True,
                       help="End date (YYYY-MM-DD)")
    parser.add_argument("--api-url", required=True,
                       help="NestJS API base URL (e.g., http://localhost:3000)")
    parser.add_argument("--metrics", required=True,
                       help="JSON array of metrics to optimize (e.g., '[\"sharpeRatio\"]')")
    parser.add_argument("--postgres-url", required=True,
                       help="PostgreSQL connection URL for Optuna storage")

    # Optional arguments
    parser.add_argument("--interval", default="1m",
                       help="Candle interval (default: 1m)")
    parser.add_argument("--trials", "-n", type=int, default=100,
                       help="Number of optimization trials (default: 100)")

    return parser.parse_args()


def format_param_info(optimizable_params: List[Tuple[str, str, Any]]) -> str:
    """Format optimizable parameters for display."""
    lines = []
    for path, ptype, value in optimizable_params:
        if ptype in ("int", "float"):
            lines.append(f"  {path}: [{value['min']}, {value['max']}] ({ptype})")
        elif ptype == "categorical":
            lines.append(f"  {path}: {value} (categorical)")
    return "\n".join(lines)


def _create_best_trial(params):
    """Create a mock trial object to rebuild config from best params."""
    class BestTrial:
        def __init__(self, params):
            self._params = params
        def suggest_int(self, name, min_val, _max_val):
            return self._params.get(name, min_val)
        def suggest_float(self, name, min_val, _max_val):
            return self._params.get(name, min_val)
        def suggest_categorical(self, name, choices):
            return self._params.get(name, choices[0])
    return BestTrial(params)


# ==================== MAIN ====================

def main():
    args = parse_args()

    print("=" * 60, file=sys.stderr)
    print("  OPTUNA MULTI-OBJECTIVE OPTIMIZER (PostgreSQL)", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # Start heartbeat manager immediately
    heartbeat = start_heartbeat_manager(args.api_url, args.task_id)

    try:
        # Parse inline config
        factory_config = json.loads(args.config)

        # Add symbol to config
        factory_config["symbol"] = args.symbol

        # Parse metrics array
        metrics = json.loads(args.metrics)
        num_objectives = len(metrics)

        # Extract optimizable parameters
        optimizable_params = extract_optimizable_params(factory_config)

        # Generate study name from task ID
        study_name = get_study_name(args.task_id)

        print(f"\nTask ID: {args.task_id}", file=sys.stderr)
        print(f"Study Name: {study_name}", file=sys.stderr)
        print(f"Symbol: {args.symbol}", file=sys.stderr)
        print(f"Period: {args.from_date} to {args.to_date}", file=sys.stderr)
        print(f"Interval: {args.interval}", file=sys.stderr)
        print(f"Metrics: {metrics} (all normalized to maximize)", file=sys.stderr)
        print(f"Trials: {args.trials}", file=sys.stderr)
        print(f"Storage: PostgreSQL", file=sys.stderr)
        print(f"Heartbeat: enabled (10s interval)", file=sys.stderr)

        print(f"\nOptimizable parameters ({len(optimizable_params)}):", file=sys.stderr)
        print(format_param_info(optimizable_params), file=sys.stderr)

        if not optimizable_params:
            raise ValueError("No optimizable parameters found in config")

        # Get PostgreSQL storage
        storage = get_study_storage(args.postgres_url)

        print("\n" + "-" * 60, file=sys.stderr)
        print("Starting optimization...\n", file=sys.stderr)

        # Create multi-objective study - always maximize (scores pre-normalized)
        directions = ["maximize"] * num_objectives

        study = optuna.create_study(
            study_name=study_name,
            storage=storage,
            directions=directions,
            load_if_exists=True,
        )

        # Calculate remaining trials
        # args.trials is the TARGET TOTAL trials
        completed_trials = len(study.trials)
        remaining_trials = args.trials - completed_trials

        print(f"Target trials: {args.trials}", file=sys.stderr)
        print(f"Completed trials: {completed_trials}", file=sys.stderr)
        print(f"Remaining trials: {remaining_trials}", file=sys.stderr)

        if remaining_trials <= 0:
            print("Target number of trials reached. No further optimization needed.", file=sys.stderr)
        else:
            # Create objective
            objective = create_objective(
                api_url=args.api_url,
                task_id=args.task_id,
                factory_config=factory_config,
                optimizable_params=optimizable_params,
                num_objectives=num_objectives,
            )

            # Run optimization with gc_after_trial for memory stability
            study.optimize(
                objective,
                n_trials=remaining_trials,
                gc_after_trial=True,  # Clean memory after each trial
                show_progress_bar=True,
            )

        # Get best trials (Pareto front for multi-objective, single best for single)
        if num_objectives == 1:
            best_trials = [study.best_trial]
        else:
            best_trials = study.best_trials

        # Success - print results
        print("\n" + "=" * 60, file=sys.stderr)
        print("  OPTIMIZATION COMPLETE", file=sys.stderr)
        print("=" * 60, file=sys.stderr)
        print(f"\nPareto front: {len(best_trials)} solution(s)", file=sys.stderr)

        # Extract config_ids from best trials (already stored in user_attrs during optimization)
        best_config_ids = []
        for i, trial in enumerate(best_trials):
            config_id = trial.user_attrs.get("config_id")
            if config_id:
                best_config_ids.append(config_id)

            if num_objectives == 1:
                print(f"  Best score: {trial.value:.4f}", file=sys.stderr)
            else:
                print(f"  Solution {i+1}: {trial.values}", file=sys.stderr)

        # Stop heartbeat before final API calls
        stop_heartbeat_manager()

        # Send config IDs to NestJS (results already exist in DB, no re-running needed)
        complete_task(args.api_url, args.task_id, best_config_ids)

        # Output result JSON
        output = {
            "study_name": study_name,
            "num_objectives": num_objectives,
            "pareto_front_size": len(best_trials),
            "best_config_ids": len(best_config_ids),
            "n_trials": len(study.trials),
        }
        print(json.dumps(output, indent=2))

    except optuna.TrialPruned:
        print("\nOptimization cancelled by user", file=sys.stderr)
        stop_heartbeat_manager()
        fail_task(args.api_url, args.task_id, "Optimization cancelled by user")
        sys.exit(0)
    except Exception as e:
        print(f"\nOptimization failed: {e}", file=sys.stderr)
        stop_heartbeat_manager()
        fail_task(args.api_url, args.task_id, str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Optuna-based Multi-Objective Parameter Optimizer

This optimizer integrates with the NestJS backtest module via HTTP API.
When spawned by BacktestRunnerService, it:
  1. Receives task configuration via CLI arguments
  2. Calls POST /backtest/run-single for each trial
  3. Stores Optuna study in per-task SQLite DB
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
        --run-date 2024-01-15
"""

import argparse
import json
import os
import sys
import copy
import uuid
import requests
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union

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


# ==================== API INTEGRATION ====================

def run_backtest_via_api(
    api_url: str,
    task_id: str,
    config_id: str,
    strategy_config: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Call the NestJS run-single endpoint to execute a backtest.
    Returns the response with score and metrics.
    """
    try:
        response = requests.post(
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


def complete_task(api_url: str, task_id: str, best_configs: List[Dict[str, Any]]) -> None:
    """Notify NestJS with Pareto-optimal configs."""
    try:
        response = requests.post(
            f"{api_url}/backtest/task/{task_id}/complete",
            json={
                "bestConfigs": best_configs,
            },
            headers=get_api_headers(),
            timeout=30,
        )
        if not response.ok:
            print(f"Warning: Task completion returned HTTP {response.status_code}", file=sys.stderr)
    except requests.RequestException as e:
        print(f"Warning: Failed to notify task completion: {e}", file=sys.stderr)


def fail_task(api_url: str, task_id: str, error: str) -> None:
    """Notify NestJS that optimization failed."""
    try:
        response = requests.post(
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
    """Check if task has been cancelled."""
    try:
        response = requests.get(
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


def get_study_storage(task_id: str, run_date: str, base_dir: str = "result") -> str:
    """
    Return SQLite storage URL for per-task Optuna study.
    Creates the directory if it doesn't exist.
    """
    study_dir = Path(base_dir) / run_date / task_id
    study_dir.mkdir(parents=True, exist_ok=True)
    db_path = study_dir / "optuna-study.db"
    return f"sqlite:///{db_path}"


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
    Returns list of scores for multi-objective, single float for single-objective.
    """
    trial_count = 0

    def objective(trial: Trial) -> Union[float, List[float]]:
        nonlocal trial_count
        trial_count += 1

        # Check for cancellation every N trials
        if trial_count % check_interval == 0:
            if is_task_cancelled(api_url, task_id):
                raise optuna.TrialPruned("Task was cancelled")

        # Build concrete config from trial
        config = build_config_from_trial(factory_config, optimizable_params, trial)

        # Generate unique config ID
        config_id = str(uuid.uuid4())

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

        # Return single value or list based on number of objectives
        if num_objectives == 1:
            return scores[0] if scores else float("-inf")
        return scores if len(scores) == num_objectives else [float("-inf")] * num_objectives

    return objective


# ==================== CLI ====================

def parse_args():
    parser = argparse.ArgumentParser(
        description="Optuna-based parameter optimizer (API mode)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    # Required arguments for API mode
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

    # Optional arguments
    parser.add_argument("--interval", default="1m",
                       help="Candle interval (default: 1m)")
    parser.add_argument("--run-date",
                       help="Run date for result folder")
    parser.add_argument("--api-url", required=True,
                       help="NestJS API base URL (e.g., http://localhost:3000)")
    parser.add_argument("--trials", "-n", type=int, default=100,
                       help="Number of optimization trials (default: 100)")
    parser.add_argument("--metrics", required=True,
                       help="JSON array of metrics to optimize (e.g., '[\"sharpeRatio\"]')")

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
    print("  OPTUNA MULTI-OBJECTIVE OPTIMIZER", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

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

        print(f"\nTask ID: {args.task_id}", file=sys.stderr)
        print(f"Symbol: {args.symbol}", file=sys.stderr)
        print(f"Period: {args.from_date} to {args.to_date}", file=sys.stderr)
        print(f"Interval: {args.interval}", file=sys.stderr)
        print(f"Metrics: {metrics} (all normalized to maximize)", file=sys.stderr)
        print(f"Trials: {args.trials}", file=sys.stderr)
        print(f"API URL: {args.api_url}", file=sys.stderr)

        print(f"\nOptimizable parameters ({len(optimizable_params)}):", file=sys.stderr)
        print(format_param_info(optimizable_params), file=sys.stderr)

        if not optimizable_params:
            raise ValueError("No optimizable parameters found in config")

        # Get per-task storage path
        run_date = args.run_date or datetime.now().strftime("%Y-%m-%d")
        storage = get_study_storage(args.task_id, run_date)

        print(f"\nStorage: {storage}", file=sys.stderr)
        print("\n" + "-" * 60, file=sys.stderr)
        print("Starting optimization...\n", file=sys.stderr)

        # Create multi-objective study - always maximize (scores pre-normalized)
        study_name = f"task-{args.task_id}"
        directions = ["maximize"] * num_objectives

        study = optuna.create_study(
            study_name=study_name,
            storage=storage,
            directions=directions,
            load_if_exists=True,
        )

        # Create objective
        objective = create_objective(
            api_url=args.api_url,
            task_id=args.task_id,
            factory_config=factory_config,
            optimizable_params=optimizable_params,
            num_objectives=num_objectives,
        )

        # Run optimization
        study.optimize(objective, n_trials=args.trials, show_progress_bar=True)

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

        # Build configs for all Pareto-optimal trials
        best_configs = []
        for i, trial in enumerate(best_trials):
            config = build_config_from_trial(
                factory_config, optimizable_params, _create_best_trial(trial.params)
            )
            best_configs.append(config)

            if num_objectives == 1:
                print(f"  Best score: {trial.value:.4f}", file=sys.stderr)
            else:
                print(f"  Solution {i+1}: {trial.values}", file=sys.stderr)

        # Send Pareto-optimal configs to NestJS
        complete_task(args.api_url, args.task_id, best_configs)

        # Output result JSON
        output = {
            "study_name": study_name,
            "num_objectives": num_objectives,
            "pareto_front_size": len(best_trials),
            "best_configs": best_configs,
            "n_trials": len(study.trials),
        }
        print(json.dumps(output, indent=2))

    except optuna.TrialPruned:
        print("\nOptimization cancelled by user", file=sys.stderr)
        fail_task(args.api_url, args.task_id, "Optimization cancelled by user")
        sys.exit(0)
    except Exception as e:
        print(f"\nOptimization failed: {e}", file=sys.stderr)
        fail_task(args.api_url, args.task_id, str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()

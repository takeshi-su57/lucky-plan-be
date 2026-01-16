#!/usr/bin/env python3
"""
Optuna-based Parameter Optimizer

Orchestrates parameter optimization using a Strategy Factory JSON format.
The factory JSON is like a regular StrategyConfig, but params can be:
  - Fixed values (number, boolean) - used as-is
  - Range objects {"min": x, "max": y} - becomes suggest_int or suggest_float
  - Arrays [1, 2, 3] or [true, false] - becomes suggest_categorical

Usage:
    python optimizer.py \
        --factory strategy-factory.json \
        --from 2023-01-01 \
        --to 2024-01-01 \
        --trials 100 \
        --metric sharpeRatio

Example Factory JSON:
{
  "symbol": "BTCUSDT",
  "name": "EMA Optimization",
  "signal": {
    "type": "emaCrossover",
    "params": {
      "fastPeriod": { "min": 5, "max": 50 },
      "slowPeriod": { "min": 50, "max": 200 },
      "timeframe": 60,
      "useCurrentCandle": [true, false]
    }
  },
  "filters": [],
  "risk": {
    "type": "fixed",
    "params": { "positionSizeUsdt": 1000, "timeframe": 60, "useCurrentCandle": false }
  },
  "exits": [],
  "settings": { "capitalBase": 10000 }
}
"""

import argparse
import json
import subprocess
import sys
import copy
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Tuple, Union

import optuna
from optuna.trial import Trial


# Get the project root directory
SCRIPT_DIR = Path(__file__).parent.absolute()
OPTIMIZER_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = OPTIMIZER_DIR.parent.parent.parent
BACKTEST_RUNNER = PROJECT_ROOT / "src" / "backtest" / "optimizer" / "run-single-backtest.ts"
DEFAULT_STORAGE = f"sqlite:///{OPTIMIZER_DIR}/optuna-studies.db"

# Predefined composite score formulas
# Each formula is a function that takes a metrics dict and returns a score
# Higher score = better (all formulas are maximized)
COMPOSITE_FORMULAS = {
    "calmar": {
        "description": "Annual return / Max drawdown - balances return vs risk",
        "calculate": lambda m: (
            m.get("totalPnlPercent", 0) / max(abs(m.get("maxDrawdownPercent", 1)), 0.1)
        ),
    },
    "risk_adjusted": {
        "description": "PnL penalized by drawdown: pnl / (1 + drawdown)",
        "calculate": lambda m: (
            m.get("totalPnlPercent", 0) / (1 + abs(m.get("maxDrawdownPercent", 0)) / 100)
        ),
    },
    "sortino_like": {
        "description": "Sharpe with drawdown penalty: sharpe * (1 - drawdown/100)",
        "calculate": lambda m: (
            m.get("sharpeRatio", 0) * (1 - abs(m.get("maxDrawdownPercent", 0)) / 100)
        ),
    },
    "balanced": {
        "description": "All-around: sharpe * winRate * (1 - drawdown/100)",
        "calculate": lambda m: (
            m.get("sharpeRatio", 0) *
            (m.get("winRate", 0) / 100) *
            (1 - abs(m.get("maxDrawdownPercent", 0)) / 100)
        ),
    },
    "conservative": {
        "description": "Heavy drawdown penalty: sharpe * (1 - drawdown/50)^2",
        "calculate": lambda m: (
            m.get("sharpeRatio", 0) *
            max(0, 1 - abs(m.get("maxDrawdownPercent", 0)) / 50) ** 2
        ),
    },
    "aggressive": {
        "description": "Maximize returns: pnl * sqrt(winRate/100)",
        "calculate": lambda m: (
            m.get("totalPnlPercent", 0) *
            (max(m.get("winRate", 0), 0) / 100) ** 0.5
        ),
    },
    "profit_factor_weighted": {
        "description": "Profit factor with win rate: profitFactor * winRate/100",
        "calculate": lambda m: (
            m.get("profitFactor", 0) * (m.get("winRate", 0) / 100)
        ),
    },
}

# List of single metrics (non-composite)
SINGLE_METRICS = ["sharpeRatio", "totalPnlPercent", "winRate", "profitFactor", "maxDrawdownPercent"]

# All available metrics
ALL_METRICS = SINGLE_METRICS + list(COMPOSITE_FORMULAS.keys())


def calculate_metric_value(metrics: Dict[str, Any], metric: str) -> float:
    """
    Calculate the metric value, handling both single metrics and composite formulas.
    Returns the calculated value or None if calculation fails.
    """
    if metric in COMPOSITE_FORMULAS:
        try:
            return COMPOSITE_FORMULAS[metric]["calculate"](metrics)
        except (ZeroDivisionError, TypeError, ValueError):
            return None
    else:
        return metrics.get(metric)


def is_composite_metric(metric: str) -> bool:
    """Check if a metric is a composite formula."""
    return metric in COMPOSITE_FORMULAS


# Type for parameter values in factory JSON
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
    """
    Check if a value is a categorical array [val1, val2, ...]

    A categorical param is a list of primitive values (int, float, bool, str).
    NOT a list of component configs (which have "type" and "params" keys).
    """
    if not isinstance(value, list) or len(value) == 0:
        return False

    # Check if all items are primitive values
    for item in value:
        if isinstance(item, dict):
            # This is likely a component config, not a categorical choice
            return False
        if not isinstance(item, (int, float, bool, str)):
            return False

    return True


def is_fixed_param(value: Any) -> bool:
    """Check if a value is a fixed value (not optimizable)"""
    return isinstance(value, (int, float, bool, str)) and not isinstance(value, list)


def detect_param_type(value: Any) -> str:
    """
    Detect the parameter type for Optuna.
    Returns: 'int', 'float', 'categorical', or 'fixed'
    """
    if is_range_param(value):
        # Check if min/max are floats
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
    """
    Recursively extract all optimizable parameters from the factory config.

    Returns list of tuples: (param_path, param_type, param_value)
    where param_path is like "signal.params.fastPeriod"
    """
    params = []

    for key, value in factory_config.items():
        current_path = f"{path}.{key}" if path else key

        if is_range_param(value) or is_categorical_param(value):
            param_type = detect_param_type(value)
            params.append((current_path, param_type, value))
        elif isinstance(value, dict):
            # Recurse into nested dicts
            params.extend(extract_optimizable_params(value, current_path))
        elif isinstance(value, list):
            # Check if it's a list of component configs (filters, exits)
            for i, item in enumerate(value):
                if isinstance(item, dict):
                    params.extend(extract_optimizable_params(item, f"{current_path}[{i}]"))

    return params


def suggest_param(trial: Trial, param_path: str, param_type: str, param_value: Any) -> Any:
    """
    Use Optuna trial to suggest a value for the parameter.
    """
    # Create a unique param name for Optuna
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
    """
    Set a value in a nested dict using dot notation path.
    Handles array indices like "filters[0].params.period"
    """
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
            # Find the closing bracket
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

    # Navigate to the parent and set the value
    obj = config
    for part in parts[:-1]:
        if isinstance(part, int):
            obj = obj[part]
        else:
            obj = obj[part]

    last_part = parts[-1]
    if isinstance(last_part, int):
        obj[last_part] = value
    else:
        obj[last_part] = value


def build_config_from_trial(
    factory_config: Dict[str, Any],
    optimizable_params: List[Tuple[str, str, Any]],
    trial: Trial
) -> Dict[str, Any]:
    """
    Build a concrete StrategyConfig from the factory config by sampling values.
    """
    # Deep copy the factory config
    config = copy.deepcopy(factory_config)

    # Sample and set each optimizable parameter
    for param_path, param_type, param_value in optimizable_params:
        sampled_value = suggest_param(trial, param_path, param_type, param_value)
        set_nested_value(config, param_path, sampled_value)

    return config


def run_backtest(
    from_date: str,
    to_date: str,
    config: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Run a single backtest by calling the TypeScript runner.
    """
    cmd = [
        "npx", "ts-node",
        str(BACKTEST_RUNNER),
        "--from", from_date,
        "--to", to_date,
        "--config", json.dumps(config),
    ]

    try:
        result = subprocess.run(
            cmd,
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=300,
        )

        if result.stdout.strip():
            return json.loads(result.stdout.strip())
        else:
            return {
                "success": False,
                "error": f"No output from backtest. stderr: {result.stderr}"
            }

    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Backtest timed out"}
    except json.JSONDecodeError as e:
        return {"success": False, "error": f"Failed to parse backtest output: {e}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def create_objective(
    factory_config: Dict[str, Any],
    optimizable_params: List[Tuple[str, str, Any]],
    from_date: str,
    to_date: str,
    metric: str = "sharpeRatio",
):
    """
    Create an Optuna objective function.
    Supports both single metrics and composite formulas.
    """
    # Determine if we should minimize (only for maxDrawdownPercent)
    is_minimize = metric == "maxDrawdownPercent"

    def objective(trial: Trial) -> float:
        # Build concrete config from trial
        config = build_config_from_trial(factory_config, optimizable_params, trial)

        # Run backtest
        result = run_backtest(from_date, to_date, config)

        if not result.get("success"):
            print(f"  [FAILED] {result.get('error', 'Unknown error')}", file=sys.stderr)
            return float("inf") if is_minimize else float("-inf")

        metrics = result.get("metrics", {})

        # Calculate the metric value (handles both single and composite)
        value = calculate_metric_value(metrics, metric)

        if value is None:
            print(f"  [WARNING] Metric '{metric}' is None", file=sys.stderr)
            return float("inf") if is_minimize else float("-inf")

        # Print progress with additional context for composite metrics
        if is_composite_metric(metric):
            print(
                f"  Trial {trial.number}: {metric}={value:.4f}, "
                f"sharpe={metrics.get('sharpeRatio', 0):.2f}, "
                f"pnl={metrics.get('totalPnlPercent', 0):.1f}%, "
                f"dd={metrics.get('maxDrawdownPercent', 0):.1f}%, "
                f"wr={metrics.get('winRate', 0):.1f}%",
                file=sys.stderr
            )
        else:
            print(
                f"  Trial {trial.number}: {metric}={value:.4f}, "
                f"trades={metrics.get('totalTrades', 0)}, "
                f"winRate={metrics.get('winRate', 0):.1f}%",
                file=sys.stderr
            )

        return value

    return objective


def get_default_direction(metric: str) -> str:
    """Get the default optimization direction for a metric."""
    # maxDrawdownPercent should be minimized, everything else maximized
    if metric == "maxDrawdownPercent":
        return "minimize"
    return "maximize"


def create_multi_objective(
    factory_config: Dict[str, Any],
    optimizable_params: List[Tuple[str, str, Any]],
    from_date: str,
    to_date: str,
    metrics: List[str],
    directions: List[str],
):
    """
    Create an Optuna multi-objective function.
    Returns a tuple of metric values for Pareto front optimization.
    """

    def objective(trial: Trial) -> Tuple[float, ...]:
        # Build concrete config from trial
        config = build_config_from_trial(factory_config, optimizable_params, trial)

        # Run backtest
        result = run_backtest(from_date, to_date, config)

        if not result.get("success"):
            print(f"  [FAILED] {result.get('error', 'Unknown error')}", file=sys.stderr)
            # Return worst values based on directions
            return tuple(
                float("inf") if d == "minimize" else float("-inf")
                for d in directions
            )

        backtest_metrics = result.get("metrics", {})

        # Calculate all metric values
        values = []
        for metric, direction in zip(metrics, directions):
            value = calculate_metric_value(backtest_metrics, metric)
            if value is None:
                value = float("inf") if direction == "minimize" else float("-inf")
            values.append(value)

        # Print progress
        values_str = ", ".join(f"{m}={v:.4f}" for m, v in zip(metrics, values))
        print(f"  Trial {trial.number}: {values_str}", file=sys.stderr)

        return tuple(values)

    return objective


def format_metrics_help() -> str:
    """Format available metrics for help text."""
    lines = ["\nAvailable metrics:"]
    lines.append("  Single metrics:")
    for m in SINGLE_METRICS:
        lines.append(f"    {m}")
    lines.append("  Composite metrics:")
    for name, info in COMPOSITE_FORMULAS.items():
        lines.append(f"    {name}: {info['description']}")
    return "\n".join(lines)


def parse_args():
    parser = argparse.ArgumentParser(
        description="Optuna-based parameter optimizer using Strategy Factory JSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__ + format_metrics_help()
    )

    # Factory config
    parser.add_argument("--factory", "-f", required=True,
                       help="Path to Strategy Factory JSON file")

    # Date range
    parser.add_argument("--from", dest="from_date", required=True,
                       help="Start date (YYYY-MM-DD)")
    parser.add_argument("--to", dest="to_date", required=True,
                       help="End date (YYYY-MM-DD)")

    # Optimization settings
    parser.add_argument("--trials", "-n", type=int, default=100,
                       help="Number of optimization trials (default: 100)")
    parser.add_argument("--metric", "-m", default="sharpeRatio",
                       choices=ALL_METRICS,
                       help="Metric to optimize (default: sharpeRatio). Use --help to see composite metrics.")
    parser.add_argument("--direction", default="maximize",
                       choices=["maximize", "minimize"],
                       help="Optimization direction (default: maximize)")

    # Multi-objective optimization
    parser.add_argument("--multi-objective", dest="multi_objective",
                       help="Comma-separated metrics for multi-objective optimization (e.g., 'sharpeRatio,maxDrawdownPercent')")
    parser.add_argument("--directions",
                       help="Comma-separated directions for multi-objective (e.g., 'maximize,minimize'). Defaults based on metric type.")

    parser.add_argument("--list-metrics", action="store_true",
                       help="List all available metrics and exit")

    # Output settings
    parser.add_argument("--output", "-o", help="Output file for results (JSON)")
    parser.add_argument("--study-name", help="Optuna study name (to resume an existing study). If not provided, a unique name with timestamp is generated.")
    parser.add_argument("--storage", default=DEFAULT_STORAGE,
                       help=f"Optuna storage URL (default: SQLite in optimizer dir)")

    return parser.parse_args()


def format_param_info(optimizable_params: List[Tuple[str, str, Any]]) -> str:
    """Format optimizable parameters for display."""
    lines = []
    for path, ptype, value in optimizable_params:
        if ptype == "int" or ptype == "float":
            lines.append(f"  {path}: [{value['min']}, {value['max']}] ({ptype})")
        elif ptype == "categorical":
            lines.append(f"  {path}: {value} (categorical)")
    return "\n".join(lines)


def print_metrics_list():
    """Print available metrics and exit."""
    print("=" * 60)
    print("  AVAILABLE METRICS")
    print("=" * 60)
    print("\nSingle Metrics (raw backtest values):")
    for m in SINGLE_METRICS:
        print(f"  {m}")
    print("\nComposite Metrics (calculated formulas):")
    for name, info in COMPOSITE_FORMULAS.items():
        print(f"  {name}")
        print(f"    {info['description']}")
    print()


def main():
    # Handle --list-metrics before full arg parsing (since factory/from/to are required)
    if "--list-metrics" in sys.argv:
        print_metrics_list()
        sys.exit(0)

    args = parse_args()

    # Load factory config
    factory_path = Path(args.factory)
    if not factory_path.exists():
        print(f"Error: Factory file not found: {factory_path}", file=sys.stderr)
        sys.exit(1)

    with open(factory_path) as f:
        factory_config = json.load(f)

    # Extract optimizable parameters
    optimizable_params = extract_optimizable_params(factory_config)

    if not optimizable_params:
        print("Warning: No optimizable parameters found in factory config.", file=sys.stderr)
        print("All parameters are fixed values.", file=sys.stderr)

    # Determine if multi-objective mode
    is_multi_objective = args.multi_objective is not None

    if is_multi_objective:
        # Parse multi-objective metrics and directions
        metrics = [m.strip() for m in args.multi_objective.split(",")]

        # Validate metrics
        for m in metrics:
            if m not in ALL_METRICS:
                print(f"Error: Unknown metric '{m}'. Use --list-metrics to see available metrics.", file=sys.stderr)
                sys.exit(1)

        # Parse or generate directions
        if args.directions:
            directions = [d.strip() for d in args.directions.split(",")]
            if len(directions) != len(metrics):
                print(f"Error: Number of directions ({len(directions)}) must match number of metrics ({len(metrics)})", file=sys.stderr)
                sys.exit(1)
        else:
            # Auto-determine directions
            directions = [get_default_direction(m) for m in metrics]

        run_multi_objective(args, factory_config, optimizable_params, metrics, directions)
    else:
        run_single_objective(args, factory_config, optimizable_params)


def run_single_objective(args, factory_config, optimizable_params):
    """Run single-objective optimization."""
    # Print header
    print("=" * 60, file=sys.stderr)
    print("  OPTUNA PARAMETER OPTIMIZER", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(f"\nFactory: {args.factory}", file=sys.stderr)
    print(f"Symbol: {factory_config.get('symbol', 'N/A')}", file=sys.stderr)
    print(f"Strategy: {factory_config.get('name', 'N/A')}", file=sys.stderr)
    print(f"Period: {args.from_date} to {args.to_date}", file=sys.stderr)

    # Show metric info with formula description for composite metrics
    if is_composite_metric(args.metric):
        formula_desc = COMPOSITE_FORMULAS[args.metric]["description"]
        print(f"Metric: {args.metric} (composite, {args.direction})", file=sys.stderr)
        print(f"  Formula: {formula_desc}", file=sys.stderr)
    else:
        print(f"Metric: {args.metric} ({args.direction})", file=sys.stderr)

    print(f"Trials: {args.trials}", file=sys.stderr)
    print(f"Storage: {args.storage}", file=sys.stderr)
    print(f"\nDashboard: ./src/backtest/optimizer/run-dashboard.sh", file=sys.stderr)

    print(f"\nOptimizable parameters ({len(optimizable_params)}):", file=sys.stderr)
    print(format_param_info(optimizable_params), file=sys.stderr)

    print("\n" + "-" * 60, file=sys.stderr)
    print("Starting optimization...\n", file=sys.stderr)

    # Create study
    direction = args.direction
    if args.metric == "maxDrawdownPercent" and direction == "maximize":
        direction = "minimize"

    # Generate unique study name with timestamp if not provided
    if args.study_name:
        study_name = args.study_name
        load_if_exists = True
    else:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        config_name = factory_config.get('name', 'strategy').replace(' ', '-')
        study_name = f"{config_name}-{timestamp}"
        load_if_exists = False

    study = optuna.create_study(
        study_name=study_name,
        storage=args.storage,
        direction=direction,
        load_if_exists=load_if_exists,
    )

    # Create and run objective
    objective = create_objective(
        factory_config=factory_config,
        optimizable_params=optimizable_params,
        from_date=args.from_date,
        to_date=args.to_date,
        metric=args.metric,
    )

    study.optimize(objective, n_trials=args.trials, show_progress_bar=True)

    # Print results
    print("\n" + "=" * 60, file=sys.stderr)
    print("  OPTIMIZATION RESULTS", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    print(f"\nBest {args.metric}: {study.best_value:.4f}", file=sys.stderr)
    if is_composite_metric(args.metric):
        print(f"  ({COMPOSITE_FORMULAS[args.metric]['description']})", file=sys.stderr)

    print(f"\nBest parameters:", file=sys.stderr)
    for param, value in study.best_params.items():
        readable_path = param.replace("_", ".")
        print(f"  {readable_path}: {value}", file=sys.stderr)

    # Build the best config
    best_config = build_config_from_trial(
        factory_config,
        optimizable_params,
        _create_best_trial(study.best_params)
    )

    # Prepare output
    output = {
        "study_name": study.study_name,
        "best_value": study.best_value,
        "best_params": study.best_params,
        "best_config": best_config,
        "metric": args.metric,
        "metric_type": "composite" if is_composite_metric(args.metric) else "single",
        "direction": direction,
        "n_trials": len(study.trials),
        "factory_file": str(args.factory),
    }

    if is_composite_metric(args.metric):
        output["metric_formula"] = COMPOSITE_FORMULAS[args.metric]["description"]

    # Output JSON to stdout
    print(json.dumps(output, indent=2))

    # Save to file if specified
    if args.output:
        with open(args.output, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nResults saved to: {args.output}", file=sys.stderr)

    print("\n" + "=" * 60, file=sys.stderr)


def run_multi_objective(args, factory_config, optimizable_params, metrics, directions):
    """Run multi-objective optimization with Pareto front."""
    # Print header
    print("=" * 60, file=sys.stderr)
    print("  OPTUNA MULTI-OBJECTIVE OPTIMIZER", file=sys.stderr)
    print("=" * 60, file=sys.stderr)
    print(f"\nFactory: {args.factory}", file=sys.stderr)
    print(f"Symbol: {factory_config.get('symbol', 'N/A')}", file=sys.stderr)
    print(f"Strategy: {factory_config.get('name', 'N/A')}", file=sys.stderr)
    print(f"Period: {args.from_date} to {args.to_date}", file=sys.stderr)

    print(f"\nObjectives:", file=sys.stderr)
    for m, d in zip(metrics, directions):
        if is_composite_metric(m):
            print(f"  {m} ({d}) - {COMPOSITE_FORMULAS[m]['description']}", file=sys.stderr)
        else:
            print(f"  {m} ({d})", file=sys.stderr)

    print(f"\nTrials: {args.trials}", file=sys.stderr)
    print(f"Storage: {args.storage}", file=sys.stderr)
    print(f"\nDashboard: ./src/backtest/optimizer/run-dashboard.sh", file=sys.stderr)

    print(f"\nOptimizable parameters ({len(optimizable_params)}):", file=sys.stderr)
    print(format_param_info(optimizable_params), file=sys.stderr)

    print("\n" + "-" * 60, file=sys.stderr)
    print("Starting multi-objective optimization...\n", file=sys.stderr)

    # Generate unique study name with timestamp if not provided
    if args.study_name:
        study_name = args.study_name
        load_if_exists = True
    else:
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        config_name = factory_config.get('name', 'strategy').replace(' ', '-')
        study_name = f"{config_name}-multi-{timestamp}"
        load_if_exists = False

    # Create multi-objective study
    study = optuna.create_study(
        study_name=study_name,
        storage=args.storage,
        directions=directions,
        load_if_exists=load_if_exists,
    )

    # Create and run objective
    objective = create_multi_objective(
        factory_config=factory_config,
        optimizable_params=optimizable_params,
        from_date=args.from_date,
        to_date=args.to_date,
        metrics=metrics,
        directions=directions,
    )

    study.optimize(objective, n_trials=args.trials, show_progress_bar=True)

    # Get Pareto front trials
    pareto_trials = study.best_trials

    # Print results
    print("\n" + "=" * 60, file=sys.stderr)
    print(f"  PARETO FRONT ({len(pareto_trials)} optimal solutions)", file=sys.stderr)
    print("=" * 60, file=sys.stderr)

    # Print table header
    header = "Trial │ " + " │ ".join(f"{m[:12]:>12}" for m in metrics)
    print(f"\n{header}", file=sys.stderr)
    print("─" * len(header), file=sys.stderr)

    # Print each Pareto optimal trial
    for trial in pareto_trials:
        values_str = " │ ".join(f"{v:>12.4f}" for v in trial.values)
        print(f"{trial.number:>5} │ {values_str}", file=sys.stderr)

    # Build configs for all Pareto optimal trials
    pareto_results = []
    for trial in pareto_trials:
        config = build_config_from_trial(
            factory_config,
            optimizable_params,
            _create_best_trial(trial.params)
        )
        pareto_results.append({
            "trial_number": trial.number,
            "values": dict(zip(metrics, trial.values)),
            "params": trial.params,
            "config": config,
        })

    # Prepare output
    output = {
        "study_name": study.study_name,
        "mode": "multi_objective",
        "metrics": metrics,
        "directions": directions,
        "n_trials": len(study.trials),
        "n_pareto_optimal": len(pareto_trials),
        "pareto_front": pareto_results,
        "factory_file": str(args.factory),
    }

    # Output JSON to stdout
    print(json.dumps(output, indent=2))

    # Save to file if specified
    if args.output:
        with open(args.output, "w") as f:
            json.dump(output, f, indent=2)
        print(f"\nResults saved to: {args.output}", file=sys.stderr)

    print("\n" + "=" * 60, file=sys.stderr)
    print(f"\nTip: Use the Optuna dashboard to visualize the Pareto front:", file=sys.stderr)
    print(f"  ./src/backtest/optimizer/run-dashboard.sh", file=sys.stderr)


def _create_best_trial(params):
    """Create a mock trial object to rebuild config from best params."""
    class BestTrial:
        def __init__(self, params):
            self._params = params
        def suggest_int(self, name, min_val, max_val):
            if name in self._params:
                return self._params[name]
            return min_val
        def suggest_float(self, name, min_val, max_val):
            if name in self._params:
                return self._params[name]
            return min_val
        def suggest_categorical(self, name, choices):
            if name in self._params:
                return self._params[name]
            return choices[0]
    return BestTrial(params)


if __name__ == "__main__":
    main()

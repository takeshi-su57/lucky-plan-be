#!/bin/bash

# Optuna Dashboard Script
# Launches the Optuna dashboard for visualizing optimization results

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
INSTALL_MODE_FILE="$SCRIPT_DIR/.install-mode"
DEFAULT_STORAGE="sqlite:///$SCRIPT_DIR/optuna-studies.db"

# Check if setup has been run
if [ ! -f "$INSTALL_MODE_FILE" ]; then
    echo "Error: Setup has not been run."
    echo "Please run setup first:"
    echo ""
    echo "  ./src/backtest/optimizer/setup.sh"
    echo ""
    exit 1
fi

# Parse arguments
STORAGE="${1:-$DEFAULT_STORAGE}"
PORT="${2:-8080}"

echo "=============================================="
echo "  Optuna Dashboard"
echo "=============================================="
echo ""
echo "Storage: $STORAGE"
echo "URL: http://localhost:$PORT"
echo ""
echo "Press Ctrl+C to stop"
echo ""

INSTALL_MODE=$(cat "$INSTALL_MODE_FILE")

if [ "$INSTALL_MODE" = "venv" ]; then
    source "$VENV_DIR/bin/activate"
    optuna-dashboard "$STORAGE" --port "$PORT"
else
    # For user install, optuna-dashboard is in ~/.local/bin
    if command -v optuna-dashboard &> /dev/null; then
        optuna-dashboard "$STORAGE" --port "$PORT"
    elif [ -f "$HOME/.local/bin/optuna-dashboard" ]; then
        "$HOME/.local/bin/optuna-dashboard" "$STORAGE" --port "$PORT"
    else
        echo "Error: optuna-dashboard not found."
        echo "Try running: pip3 install --user optuna-dashboard"
        exit 1
    fi
fi

#!/bin/bash

# Optimizer Run Script
# Runs the optimizer with the correct Python environment

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
INSTALL_MODE_FILE="$SCRIPT_DIR/.install-mode"

# Check if setup has been run
if [ ! -f "$INSTALL_MODE_FILE" ]; then
    echo "Error: Setup has not been run."
    echo "Please run setup first:"
    echo ""
    echo "  ./src/backtest/optimizer/setup.sh"
    echo ""
    exit 1
fi

INSTALL_MODE=$(cat "$INSTALL_MODE_FILE")

if [ "$INSTALL_MODE" = "venv" ]; then
    # Use virtual environment
    source "$VENV_DIR/bin/activate"
    python "$SCRIPT_DIR/python/optimizer.py" "$@"
else
    # Use system Python (user install)
    python3 "$SCRIPT_DIR/python/optimizer.py" "$@"
fi

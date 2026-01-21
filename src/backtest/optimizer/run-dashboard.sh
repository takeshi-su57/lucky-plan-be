#!/bin/bash

# Optuna Dashboard Script
# Launches the Optuna dashboard for visualizing optimization results
# Auto-runs setup.sh if dependencies are not installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
INSTALL_MODE_FILE="$SCRIPT_DIR/.install-mode"
DEFAULT_STORAGE="sqlite:///$SCRIPT_DIR/optuna-studies.db"

# Function to check if optuna-dashboard is available
check_dependencies() {
    local python_cmd="$1"
    $python_cmd -c "import optuna_dashboard" 2>/dev/null
    return $?
}

# Auto-run setup if not done or dependencies are missing
run_setup_if_needed() {
    local need_setup=false

    if [ ! -f "$INSTALL_MODE_FILE" ]; then
        echo "[run-dashboard] Setup has not been run. Running setup.sh..." >&2
        need_setup=true
    else
        INSTALL_MODE=$(cat "$INSTALL_MODE_FILE")
        if [ "$INSTALL_MODE" = "venv" ]; then
            if [ ! -f "$VENV_DIR/bin/activate" ]; then
                echo "[run-dashboard] Virtual environment missing. Running setup.sh..." >&2
                need_setup=true
            else
                source "$VENV_DIR/bin/activate"
                if ! check_dependencies python; then
                    echo "[run-dashboard] Dependencies missing in venv. Running setup.sh..." >&2
                    need_setup=true
                fi
            fi
        else
            if ! check_dependencies python3; then
                echo "[run-dashboard] Dependencies missing. Running setup.sh..." >&2
                need_setup=true
            fi
        fi
    fi

    if [ "$need_setup" = true ]; then
        bash "$SCRIPT_DIR/setup.sh"
        if [ $? -ne 0 ]; then
            echo "[run-dashboard] Setup failed!" >&2
            exit 1
        fi
    fi
}

# Ensure dependencies are ready
run_setup_if_needed

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

# Read install mode (may have been updated by setup)
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

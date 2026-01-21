#!/bin/bash

# Optimizer Run Script
# Runs the optimizer with the correct Python environment
# Auto-runs setup.sh if dependencies are not installed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
INSTALL_MODE_FILE="$SCRIPT_DIR/.install-mode"

# Function to check if optuna is importable
check_dependencies() {
    local python_cmd="$1"
    $python_cmd -c "import optuna; import requests" 2>/dev/null
    return $?
}

# Auto-run setup if not done or dependencies are missing
run_setup_if_needed() {
    local need_setup=false

    if [ ! -f "$INSTALL_MODE_FILE" ]; then
        echo "[run-optimizer] Setup has not been run. Running setup.sh..." >&2
        need_setup=true
    else
        INSTALL_MODE=$(cat "$INSTALL_MODE_FILE")
        if [ "$INSTALL_MODE" = "venv" ]; then
            if [ ! -f "$VENV_DIR/bin/activate" ]; then
                echo "[run-optimizer] Virtual environment missing. Running setup.sh..." >&2
                need_setup=true
            else
                source "$VENV_DIR/bin/activate"
                if ! check_dependencies python; then
                    echo "[run-optimizer] Dependencies missing in venv. Running setup.sh..." >&2
                    need_setup=true
                fi
            fi
        else
            if ! check_dependencies python3; then
                echo "[run-optimizer] Dependencies missing. Running setup.sh..." >&2
                need_setup=true
            fi
        fi
    fi

    if [ "$need_setup" = true ]; then
        bash "$SCRIPT_DIR/setup.sh"
        if [ $? -ne 0 ]; then
            echo "[run-optimizer] Setup failed!" >&2
            exit 1
        fi
    fi
}

# Ensure dependencies are ready
run_setup_if_needed

# Read install mode (may have been updated by setup)
INSTALL_MODE=$(cat "$INSTALL_MODE_FILE")

if [ "$INSTALL_MODE" = "venv" ]; then
    # Use virtual environment
    source "$VENV_DIR/bin/activate"
    python "$SCRIPT_DIR/python/optimizer.py" "$@"
else
    # Use system Python (user install)
    python3 "$SCRIPT_DIR/python/optimizer.py" "$@"
fi

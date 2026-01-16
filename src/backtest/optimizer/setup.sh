#!/bin/bash

# Optimizer Setup Script
# Installs Python dependencies (uses venv if available, falls back to user install)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"
REQUIREMENTS="$SCRIPT_DIR/python/requirements.txt"

echo "=============================================="
echo "  Optimizer Setup"
echo "=============================================="
echo ""

# Check Python version
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "Error: Python not found. Please install Python 3.7+"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | cut -d' ' -f2)
echo "Found Python: $PYTHON_VERSION"

# Try to create virtual environment
USE_VENV=false

# Check if existing venv is valid
if [ -d "$VENV_DIR" ]; then
    if [ -f "$VENV_DIR/bin/activate" ]; then
        USE_VENV=true
        echo "Virtual environment already exists at $VENV_DIR"
    else
        echo "Removing invalid virtual environment..."
        rm -rf "$VENV_DIR"
    fi
fi

# Create venv if needed
if [ ! -d "$VENV_DIR" ]; then
    echo ""
    echo "Attempting to create virtual environment..."
    if $PYTHON_CMD -m venv "$VENV_DIR" 2>/dev/null; then
        if [ -f "$VENV_DIR/bin/activate" ]; then
            USE_VENV=true
            echo "Virtual environment created at $VENV_DIR"
        else
            echo "Warning: Virtual environment creation failed."
            rm -rf "$VENV_DIR"
        fi
    fi

    if [ "$USE_VENV" = false ]; then
        echo "Warning: Could not create virtual environment."
        echo "         (Install python3-venv for isolated environment)"
        echo "         Falling back to user installation..."
    fi
fi

# Install dependencies
echo ""
echo "Installing dependencies..."

if [ "$USE_VENV" = true ]; then
    source "$VENV_DIR/bin/activate"
    pip install --upgrade pip --quiet
    pip install -r "$REQUIREMENTS" --quiet

    # Mark that we're using venv
    echo "venv" > "$SCRIPT_DIR/.install-mode"
else
    # Install to user directory
    $PYTHON_CMD -m pip install --user -r "$REQUIREMENTS" --quiet

    # Mark that we're using user install
    echo "user" > "$SCRIPT_DIR/.install-mode"
fi

echo ""
echo "=============================================="
echo "  Setup Complete!"
echo "=============================================="
echo ""
echo "To run the optimizer:"
echo ""
echo "  ./src/backtest/optimizer/run-optimizer.sh \\"
echo "    --symbol BTCUSDT \\"
echo "    --from 2023-01-01 --to 2024-01-01 \\"
echo "    --signal emaCrossover \\"
echo "    --fast-period 5 100 --slow-period 50 500 \\"
echo "    --trials 100"
echo ""

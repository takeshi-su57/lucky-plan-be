/**
 * Parameter Optimizer Module
 *
 * This module provides parameter optimization using Optuna (Python).
 *
 * Components:
 * - run-single-backtest.ts: CLI to run a single backtest with JSON output
 * - python/optimizer.py: Optuna-based optimizer that calls the TS backtest
 *
 * Usage:
 *   # Install Python dependencies
 *   pip install -r src/backtest/optimizer/python/requirements.txt
 *
 *   # Run optimization
 *   python src/backtest/optimizer/python/optimizer.py \
 *     --symbol BTCUSDT \
 *     --from 2023-01-01 \
 *     --to 2024-01-01 \
 *     --signal emaCrossover \
 *     --fast-period 5 100 \
 *     --slow-period 50 500 \
 *     --timeframe 60 \
 *     --trials 100 \
 *     --metric sharpeRatio
 */

export * from './types';

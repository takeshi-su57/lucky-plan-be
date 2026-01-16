/**
 * Single Backtest Runner for Optimizer
 *
 * Runs a single backtest with a strategy config and outputs JSON result.
 * Designed to be called by Python Optuna optimizer.
 *
 * Usage:
 *   npx ts-node src/backtest/optimizer/run-single-backtest.ts \
 *     --from 2023-01-01 \
 *     --to 2024-01-01 \
 *     --config '{"symbol":"BTCUSDT","name":"test","signal":{...},"filters":[],"risk":{...},"exits":[]}'
 *
 * Output (JSON to stdout):
 *   {
 *     "success": true,
 *     "metrics": {
 *       "sharpeRatio": 1.23,
 *       "totalPnlPercent": 45.6,
 *       "winRate": 52.3,
 *       "totalTrades": 150,
 *       "maxDrawdownPercent": 12.5,
 *       "profitFactor": 1.8
 *     }
 *   }
 */

import { streamPriceData } from '../binance-fetcher';
import { ComposableBacktestEngine } from '../composable-backtest-engine';
import { ComposableStrategy } from '../core/strategy-composer';
import { StrategyConfig } from '../core/interfaces';

// Import components to ensure they're registered
import '../components';

interface BacktestParams {
  fromDate: Date;
  toDate: Date;
  config: StrategyConfig;
}

interface BacktestOutput {
  success: boolean;
  metrics?: {
    sharpeRatio: number | null;
    totalPnlPercent: number;
    totalPnlUsdt: number;
    winRate: number;
    totalTrades: number;
    maxDrawdownPercent: number;
    maxDrawdownUsdt: number;
    profitFactor: number | null;
  };
  error?: string;
}

function parseArgs(): BacktestParams {
  const args = process.argv.slice(2);
  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  let config: StrategyConfig | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--from':
      case '-f':
        fromDate = new Date(args[++i]);
        break;
      case '--to':
      case '-t':
        toDate = new Date(args[++i]);
        break;
      case '--config':
      case '-c':
        config = JSON.parse(args[++i]);
        break;
    }
  }

  if (!fromDate || !toDate || !config) {
    throw new Error('Missing required arguments: --from, --to, --config');
  }

  // Validate config has required fields
  if (!config.symbol) {
    throw new Error('Config missing required field: symbol');
  }
  if (!config.signal || !config.signal.type) {
    throw new Error('Config missing required field: signal.type');
  }
  if (!config.risk || !config.risk.type) {
    throw new Error('Config missing required field: risk.type');
  }

  // Ensure arrays exist
  config.filters = config.filters || [];
  config.exits = config.exits || [];
  config.name = config.name || `optimizer-${config.signal.type}`;

  return {
    fromDate,
    toDate,
    config,
  };
}

async function runBacktest(params: BacktestParams): Promise<BacktestOutput> {
  // Suppress console.log to get clean JSON output
  // Redirect logs to stderr instead
  const originalLog = console.log;
  console.log = (...args: any[]) => {
    process.stderr.write(args.join(' ') + '\n');
  };

  try {
    const strategy = ComposableStrategy.fromConfig(params.config);
    const capitalBase = params.config.settings?.capitalBase ?? 10000;

    const engine = new ComposableBacktestEngine(strategy, {
      symbol: params.config.symbol,
      capitalBase,
    });

    const stream = streamPriceData(
      params.config.symbol,
      '1m', // Always use 1m data, signal handles timeframe aggregation
      params.fromDate,
      params.toDate,
    );

    const result = await engine.runStream(stream);
    const extendedMetrics =
      ComposableBacktestEngine.calculateExtendedMetrics(result);

    // Restore console.log
    console.log = originalLog;

    return {
      success: true,
      metrics: {
        sharpeRatio: extendedMetrics.sharpeRatio,
        totalPnlPercent: result.totalPnlPercent,
        totalPnlUsdt: result.totalPnlUsdt,
        winRate: result.winRate,
        totalTrades: result.totalTrades,
        maxDrawdownPercent: result.maxDrawdownPercent,
        maxDrawdownUsdt: result.maxDrawdownUsdt,
        profitFactor: extendedMetrics.profitFactor,
      },
    };
  } catch (error) {
    // Restore console.log
    console.log = originalLog;

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main(): Promise<void> {
  try {
    const params = parseArgs();
    const result = await runBacktest(params);

    // Output JSON to stdout (for Python to parse)
    console.log(JSON.stringify(result));
  } catch (error) {
    const output: BacktestOutput = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
    console.log(JSON.stringify(output));
    process.exit(1);
  }
}

main();

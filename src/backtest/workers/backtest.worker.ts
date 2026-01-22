/**
 * Backtest Worker
 *
 * Worker script that runs backtests in an isolated thread.
 * Receives strategy configuration via workerData, executes backtest,
 * and returns results via parentPort.
 */
import { parentPort, workerData } from 'worker_threads';

import { ComposableStrategy } from '../core/strategy-composer';
import {
  ComposableBacktestEngine,
  ExtendedMetrics,
  ExportOptions,
} from '../composable-backtest-engine';
import { streamPriceData } from '../binance-fetcher';
import { StrategyConfig } from '../core/interfaces';
import { BacktestResult } from '../types';

// Import components to ensure they're registered
import '../components';

/**
 * Input data received from the worker pool
 */
export interface WorkerInput {
  strategyConfig: StrategyConfig;
  symbol: string;
  interval: string;
  startDate: string; // ISO string (Date not serializable across threads)
  endDate: string;
  taskId: string;
  configId: string;
}

/**
 * Backtest metrics for score calculation
 */
export interface BacktestMetrics {
  sharpeRatio: number | null;
  totalPnlPercent: number;
  totalPnlUsdt: number;
  winRate: number;
  totalTrades: number;
  maxDrawdownPercent: number;
  maxDrawdownUsdt: number;
  profitFactor: number | null;
}

/**
 * Result sent back to the worker pool
 */
export interface WorkerResult {
  success: boolean;
  result?: {
    totalTrades: number;
    winningTrades: number;
    losingTrades: number;
    winRate: number;
    totalPnlUsdt: number;
    totalPnlPercent: number;
    maxDrawdownUsdt: number;
    maxDrawdownPercent: number;
  };
  metrics?: BacktestMetrics;
  extendedMetrics?: ExtendedMetrics;
  exportFolder?: string;
  error?: string;
}

/**
 * Run a single backtest with the given configuration
 */
async function runBacktest(input: WorkerInput): Promise<WorkerResult> {
  try {
    // Create strategy from config
    const strategy = ComposableStrategy.fromConfig(input.strategyConfig);

    // Create backtest engine
    const engine = new ComposableBacktestEngine(strategy, {
      symbol: input.strategyConfig.symbol,
      initialCapital: input.strategyConfig.settings.initialCapital,
    });

    // Parse dates
    const startDate = new Date(input.startDate);
    const endDate = new Date(input.endDate);

    // Stream price data
    const candleStream = streamPriceData(
      input.strategyConfig.symbol,
      input.interval,
      startDate,
      endDate,
    );

    // Run backtest
    const result: BacktestResult = await engine.runStream(candleStream);

    // Calculate extended metrics
    const extendedMetrics =
      ComposableBacktestEngine.calculateExtendedMetrics(result);

    // Export results to filesystem
    const exportOptions: ExportOptions = {
      taskId: input.taskId,
      configId: input.configId,
      baseDir: 'result',
    };

    const exportResult = await ComposableBacktestEngine.exportResults(
      result,
      input.strategyConfig,
      exportOptions,
    );

    // Build metrics object
    const metrics: BacktestMetrics = {
      sharpeRatio: extendedMetrics.sharpeRatio,
      totalPnlPercent: result.totalPnlPercent,
      totalPnlUsdt: result.totalPnlUsdt,
      winRate: result.winRate,
      totalTrades: result.totalTrades,
      maxDrawdownPercent: result.maxDrawdownPercent,
      maxDrawdownUsdt: result.maxDrawdownUsdt,
      profitFactor: extendedMetrics.profitFactor,
    };

    return {
      success: true,
      result: {
        totalTrades: result.totalTrades,
        winningTrades: result.winningTrades,
        losingTrades: result.losingTrades,
        winRate: result.winRate,
        totalPnlUsdt: result.totalPnlUsdt,
        totalPnlPercent: result.totalPnlPercent,
        maxDrawdownUsdt: result.maxDrawdownUsdt,
        maxDrawdownPercent: result.maxDrawdownPercent,
      },
      metrics,
      extendedMetrics,
      exportFolder: exportResult.folder,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Main execution: run backtest and send result back to parent
if (parentPort && workerData) {
  runBacktest(workerData as WorkerInput)
    .then((result) => {
      parentPort!.postMessage(result);
    })
    .catch((error) => {
      parentPort!.postMessage({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

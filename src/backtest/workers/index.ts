/**
 * Worker Threads Module
 *
 * Exports for backtest worker thread functionality.
 */
export { WorkerPoolService } from './worker-pool.service';
export type {
  WorkerInput,
  WorkerResult,
  BacktestMetrics,
} from './backtest.worker';

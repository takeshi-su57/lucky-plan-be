import { registerExit } from '../../core/registry';
import { StopLossExit, StopLossParams, stopLossMeta } from './stop-loss.exit';
import {
  TrailingStopExit,
  TrailingStopParams,
  trailingStopMeta,
} from './trailing-stop.exit';
import {
  TakeProfitExit,
  TakeProfitParams,
  takeProfitMeta,
} from './take-profit.exit';
import {
  TimeBasedExit,
  TimeBasedExitParams,
  timeBasedMeta,
} from './time-based.exit';

// Export interfaces and types
export * from './exit.interface';

// Export exit implementations (risk management handlers only)
// Note: Strategy-based exits (like crossover) are now handled by SignalGenerator
export { StopLossExit, StopLossParams, stopLossMeta } from './stop-loss.exit';
export {
  TrailingStopExit,
  TrailingStopParams,
  trailingStopMeta,
} from './trailing-stop.exit';
export {
  TakeProfitExit,
  TakeProfitParams,
  takeProfitMeta,
} from './take-profit.exit';
export {
  TimeBasedExit,
  TimeBasedExitParams,
  timeBasedMeta,
} from './time-based.exit';

// Register exits with the global registry
// These are risk management exits, not strategy-based exits

// Stop Loss: percentage or ATR-based stop loss (self-contained)
registerExit(
  'stopLoss',
  (params) => new StopLossExit(params as StopLossParams),
  stopLossMeta,
);

// Trailing Stop: ATR-based trailing stop with optional activation threshold
registerExit(
  'trailingStop',
  (params) => new TrailingStopExit(params as TrailingStopParams),
  trailingStopMeta,
);

// Take Profit: fixed percentage or R-multiple target
registerExit(
  'takeProfit',
  (params) => new TakeProfitExit(params as TakeProfitParams),
  takeProfitMeta,
);

// Time-based: exit after maximum holding period
registerExit(
  'timeBased',
  (params) => new TimeBasedExit(params as TimeBasedExitParams),
  timeBasedMeta,
);

import { registerSignal } from '../../core/registry';
import {
  EMACrossoverSignal,
  EMACrossoverParams,
  emaCrossoverMeta,
} from './ema-crossover.signal';
import {
  SMACrossoverSignal,
  SMACrossoverParams,
  smaCrossoverMeta,
} from './sma-crossover.signal';
import {
  MACDCrossoverSignal,
  MACDCrossoverParams,
  macdCrossoverMeta,
} from './macd-crossover.signal';
import {
  DonchianBreakoutSignal,
  DonchianBreakoutParams,
  donchianBreakoutMeta,
} from './donchian-breakout.signal';
import {
  RSIReversalSignal,
  RSIReversalParams,
  rsiReversalMeta,
} from './rsi-reversal.signal';
import {
  BollingerBounceSignal,
  BollingerBounceParams,
  bollingerBounceMeta,
} from './bollinger-bounce.signal';

// Export interfaces and types
export * from './signal.interface';

// Export signal implementations
export {
  EMACrossoverSignal,
  EMACrossoverParams,
  emaCrossoverMeta,
} from './ema-crossover.signal';
export {
  SMACrossoverSignal,
  SMACrossoverParams,
  smaCrossoverMeta,
} from './sma-crossover.signal';
export {
  MACDCrossoverSignal,
  MACDCrossoverParams,
  macdCrossoverMeta,
} from './macd-crossover.signal';
export {
  DonchianBreakoutSignal,
  DonchianBreakoutParams,
  donchianBreakoutMeta,
} from './donchian-breakout.signal';
export {
  RSIReversalSignal,
  RSIReversalParams,
  rsiReversalMeta,
} from './rsi-reversal.signal';
export {
  BollingerBounceSignal,
  BollingerBounceParams,
  bollingerBounceMeta,
} from './bollinger-bounce.signal';

// Register signals with the global registry
registerSignal(
  'emaCrossover',
  (params) => new EMACrossoverSignal(params as EMACrossoverParams),
  emaCrossoverMeta,
);

registerSignal(
  'smaCrossover',
  (params) => new SMACrossoverSignal(params as SMACrossoverParams),
  smaCrossoverMeta,
);

registerSignal(
  'macdCrossover',
  (params) => new MACDCrossoverSignal(params as MACDCrossoverParams),
  macdCrossoverMeta,
);

registerSignal(
  'donchianBreakout',
  (params) => new DonchianBreakoutSignal(params as DonchianBreakoutParams),
  donchianBreakoutMeta,
);

registerSignal(
  'rsiReversal',
  (params) => new RSIReversalSignal(params as RSIReversalParams),
  rsiReversalMeta,
);

registerSignal(
  'bollingerBounce',
  (params) => new BollingerBounceSignal(params as BollingerBounceParams),
  bollingerBounceMeta,
);

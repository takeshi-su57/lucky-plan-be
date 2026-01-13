import { registerFilter } from '../../core/registry';
import {
  ADXTrendFilter,
  ADXTrendParams,
  adxTrendMeta,
} from './adx-trend.filter';
import {
  RSIExtremeFilter,
  RSIExtremeParams,
  rsiExtremeMeta,
} from './rsi-extreme.filter';
import {
  BollingerVolatilityFilter,
  BollingerVolatilityParams,
  bollingerVolatilityMeta,
} from './bollinger-volatility.filter';
import {
  StochasticFilter,
  StochasticFilterParams,
  stochasticFilterMeta,
} from './stochastic.filter';

// Bias filters
import {
  MAPositionFilter,
  MAPositionParams,
  maPositionMeta,
} from './ma-position.filter';
import {
  EMASlopeFilter,
  EMASlopeParams,
  emaSlopeMeta,
} from './ema-slope.filter';
import {
  EMAStackFilter,
  EMAStackParams,
  emaStackMeta,
} from './ema-stack.filter';
import {
  HTFEMABiasFilter,
  HTFEMABiasParams,
  htfEmaBiasMeta,
} from './htf-ema-bias.filter';

// Export interfaces and types
export * from './filter.interface';

// Export filter implementations
export {
  ADXTrendFilter,
  ADXTrendParams,
  adxTrendMeta,
} from './adx-trend.filter';
export {
  RSIExtremeFilter,
  RSIExtremeParams,
  rsiExtremeMeta,
} from './rsi-extreme.filter';
export {
  BollingerVolatilityFilter,
  BollingerVolatilityParams,
  bollingerVolatilityMeta,
} from './bollinger-volatility.filter';
export {
  StochasticFilter,
  StochasticFilterParams,
  stochasticFilterMeta,
} from './stochastic.filter';

// Export bias filters
export {
  MAPositionFilter,
  MAPositionParams,
  maPositionMeta,
} from './ma-position.filter';
export {
  EMASlopeFilter,
  EMASlopeParams,
  emaSlopeMeta,
} from './ema-slope.filter';
export {
  EMAStackFilter,
  EMAStackParams,
  emaStackMeta,
} from './ema-stack.filter';
export {
  HTFEMABiasFilter,
  HTFEMABiasParams,
  htfEmaBiasMeta,
} from './htf-ema-bias.filter';

// Register filters with the global registry
registerFilter(
  'adxTrend',
  (params) => new ADXTrendFilter(params as ADXTrendParams),
  adxTrendMeta,
);

registerFilter(
  'rsiExtreme',
  (params) => new RSIExtremeFilter(params as RSIExtremeParams),
  rsiExtremeMeta,
);

registerFilter(
  'bollingerVolatility',
  (params) =>
    new BollingerVolatilityFilter(params as BollingerVolatilityParams),
  bollingerVolatilityMeta,
);

registerFilter(
  'stochastic',
  (params) => new StochasticFilter(params as StochasticFilterParams),
  stochasticFilterMeta,
);

// Register bias filters
registerFilter(
  'maPosition',
  (params) => new MAPositionFilter(params as MAPositionParams),
  maPositionMeta,
);

registerFilter(
  'emaSlope',
  (params) => new EMASlopeFilter(params as EMASlopeParams),
  emaSlopeMeta,
);

registerFilter(
  'emaStack',
  (params) => new EMAStackFilter(params as EMAStackParams),
  emaStackMeta,
);

registerFilter(
  'htfEmaBias',
  (params) => new HTFEMABiasFilter(params as HTFEMABiasParams),
  htfEmaBiasMeta,
);

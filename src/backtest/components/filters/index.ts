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

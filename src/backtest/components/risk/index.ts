import { registerRisk } from '../../core/registry';
import {
  FixedSizeSizer,
  FixedSizeParams,
  fixedSizeMeta,
} from './fixed-size.sizer';
import {
  PercentageBasedSizer,
  PercentageBasedParams,
  percentageBasedMeta,
} from './percentage-based.sizer';
import {
  VolatilityLeverageFixedSizer,
  VolatilityLeverageFixedParams,
  volatilityLeverageFixedMeta,
} from './volatility-leverage-fixed.sizer';
import {
  VolatilityLeveragePercentSizer,
  VolatilityLeveragePercentParams,
  volatilityLeveragePercentMeta,
} from './volatility-leverage-percent.sizer';
import {
  VolatilityMarginFixedSizer,
  VolatilityMarginFixedParams,
  volatilityMarginFixedMeta,
} from './volatility-margin-fixed.sizer';
import {
  VolatilityMarginPercentSizer,
  VolatilityMarginPercentParams,
  volatilityMarginPercentMeta,
} from './volatility-margin-percent.sizer';

// Export interfaces and types
export * from './position-sizer.interface';

// Export sizer implementations
export {
  FixedSizeSizer,
  FixedSizeParams,
  fixedSizeMeta,
} from './fixed-size.sizer';
export {
  PercentageBasedSizer,
  PercentageBasedParams,
  percentageBasedMeta,
} from './percentage-based.sizer';
export {
  VolatilityLeverageFixedSizer,
  VolatilityLeverageFixedParams,
  volatilityLeverageFixedMeta,
} from './volatility-leverage-fixed.sizer';
export {
  VolatilityLeveragePercentSizer,
  VolatilityLeveragePercentParams,
  volatilityLeveragePercentMeta,
} from './volatility-leverage-percent.sizer';
export {
  VolatilityMarginFixedSizer,
  VolatilityMarginFixedParams,
  volatilityMarginFixedMeta,
} from './volatility-margin-fixed.sizer';
export {
  VolatilityMarginPercentSizer,
  VolatilityMarginPercentParams,
  volatilityMarginPercentMeta,
} from './volatility-margin-percent.sizer';

// Register position sizers with the global registry
registerRisk(
  'fixed',
  (params) => new FixedSizeSizer(params as FixedSizeParams),
  fixedSizeMeta,
);

registerRisk(
  'percentageBased',
  (params) => new PercentageBasedSizer(params as PercentageBasedParams),
  percentageBasedMeta,
);

registerRisk(
  'volatilityLeverageFixed',
  (params) =>
    new VolatilityLeverageFixedSizer(params as VolatilityLeverageFixedParams),
  volatilityLeverageFixedMeta,
);

registerRisk(
  'volatilityLeveragePercent',
  (params) =>
    new VolatilityLeveragePercentSizer(
      params as VolatilityLeveragePercentParams,
    ),
  volatilityLeveragePercentMeta,
);

registerRisk(
  'volatilityMarginFixed',
  (params) =>
    new VolatilityMarginFixedSizer(params as VolatilityMarginFixedParams),
  volatilityMarginFixedMeta,
);

registerRisk(
  'volatilityMarginPercent',
  (params) =>
    new VolatilityMarginPercentSizer(params as VolatilityMarginPercentParams),
  volatilityMarginPercentMeta,
);

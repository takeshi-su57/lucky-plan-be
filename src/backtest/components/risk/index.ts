import { registerRisk } from '../../core/registry';
import {
  FixedSizeSizer,
  FixedSizeParams,
  fixedSizeMeta,
} from './fixed-size.sizer';
import { ATRBasedSizer, ATRBasedParams, atrBasedMeta } from './atr-based.sizer';

// Export interfaces and types
export * from './position-sizer.interface';

// Export sizer implementations
export {
  FixedSizeSizer,
  FixedSizeParams,
  fixedSizeMeta,
} from './fixed-size.sizer';
export { ATRBasedSizer, ATRBasedParams, atrBasedMeta } from './atr-based.sizer';

// Register position sizers with the global registry
registerRisk(
  'fixed',
  (params) => new FixedSizeSizer(params as FixedSizeParams),
  fixedSizeMeta,
);

registerRisk(
  'atrBased',
  (params) => new ATRBasedSizer(params as ATRBasedParams),
  atrBasedMeta,
);

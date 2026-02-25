import { registerRisk } from '../../core/registry';
import {
  StaticSizer,
  StaticSizerParams,
  staticSizerMeta,
} from './static.sizer';
import {
  VolatilitySizer,
  VolatilitySizerParams,
  volatilitySizerMeta,
} from './volatility.sizer';

// Export interfaces and types
export * from './position-sizer.interface';

// Export sizer implementations
export {
  StaticSizer,
  StaticSizerParams,
  staticSizerMeta,
} from './static.sizer';
export {
  VolatilitySizer,
  VolatilitySizerParams,
  volatilitySizerMeta,
} from './volatility.sizer';

// Register position sizers with the global registry
registerRisk(
  'static',
  (params) => new StaticSizer(params as StaticSizerParams),
  staticSizerMeta,
);

registerRisk(
  'volatility',
  (params) => new VolatilitySizer(params as VolatilitySizerParams),
  volatilitySizerMeta,
);

import { registerPlatform } from '../../core/registry';
import { SimplePlatform, simplePlatformMeta } from './simple.platform';
import {
  GeneralPlatform,
  GeneralPlatformParams,
  generalPlatformMeta,
} from './general.platform';
import {
  GNSPlatform,
  GNSPlatformParams,
  gnsPlatformMeta,
} from './gns.platform';

// Register platform components
registerPlatform('simple', () => new SimplePlatform(), simplePlatformMeta);
registerPlatform(
  'general',
  (params) => new GeneralPlatform(params as GeneralPlatformParams),
  generalPlatformMeta,
);
registerPlatform(
  'gns',
  (params) => new GNSPlatform(params as GNSPlatformParams),
  gnsPlatformMeta,
);

// Re-export all platform components
export * from './platform.interface';
export * from './simple.platform';
export * from './general.platform';
export * from './gns.platform';

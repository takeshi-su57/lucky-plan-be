import { Module } from '@nestjs/common';

import { PlatformConfigsModule as PlatformConfigSyncModule } from 'src/web3/platform/platform-configs.module';

import { PlatformConfigsResolver } from './platform-configs.resolver';
import { PlatformConfigsService } from './platform-configs.service';

@Module({
  imports: [PlatformConfigSyncModule],
  providers: [PlatformConfigsResolver, PlatformConfigsService],
})
export class PlatformConfigsApiModule {}

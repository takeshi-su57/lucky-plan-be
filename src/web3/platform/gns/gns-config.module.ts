import { Module } from '@nestjs/common';

import { Web3Module } from 'src/web3/web3/web3.module';

import { GnsConfigService } from './gns-config.service';

/** Standalone module for `npm run config:generate:gns` (no DB contracts). */
@Module({
  imports: [Web3Module],
  providers: [GnsConfigService],
  exports: [GnsConfigService],
})
export class GnsConfigModule {}

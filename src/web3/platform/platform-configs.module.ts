import { Module } from '@nestjs/common';

import { ContractsModule } from 'src/microservices/apiService/modules/contracts/contracts.module';
import { Web3Module } from 'src/web3/web3/web3.module';

import { GnsConfigSyncService } from './gns/gns-config-sync.service';
import { GmxV2ConfigSyncService } from './gmx/v2/gmx-v2-config-sync.service';
import { AvntConfigSyncService } from './avnt/avnt-config-sync.service';

/**
 * Runtime pair/market config sync for the event parsers. Imported through
 * TradeHistoriesModule so the api, analytics and copy-trading processes all
 * apply the same Metadata overlay.
 */
@Module({
  imports: [ContractsModule, Web3Module],
  providers: [
    GnsConfigSyncService,
    GmxV2ConfigSyncService,
    AvntConfigSyncService,
  ],
  exports: [
    GnsConfigSyncService,
    GmxV2ConfigSyncService,
    AvntConfigSyncService,
  ],
})
export class PlatformConfigsModule {}

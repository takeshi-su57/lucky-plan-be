import { Module } from '@nestjs/common';

import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { PlatformConfigsModule } from 'src/web3/platform/platform-configs.module';

import { PnlSnapshotsService } from './pnlsnapshot.service';
import { PnlSnapshotFileCacheService } from './pnl-snapshot-file-cache.service';
import { EventLogsService } from './event-logs.service';
import { EventLogsResolver } from './event-logs.resolver';

@Module({
  imports: [GnsModule, PlatformConfigsModule],
  providers: [
    EventLogsResolver,
    EventLogsService,
    PnlSnapshotsService,
    PnlSnapshotFileCacheService,
  ],
  exports: [EventLogsService, PnlSnapshotsService, PnlSnapshotFileCacheService],
})
export class TradeHistoriesModule {}

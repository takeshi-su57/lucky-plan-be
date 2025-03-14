import { Module } from '@nestjs/common';

import { LogsModule } from 'src/loggers/logs.module';

import { TradeHistoriesService } from './trade-histories.service';
import { TradeHistoriesResolver } from './trade-histories.resolver';
import { PnlSnapshotsService } from './pnlsnapshot.service';

@Module({
  imports: [LogsModule],
  providers: [
    TradeHistoriesResolver,
    TradeHistoriesService,
    PnlSnapshotsService,
  ],
  exports: [TradeHistoriesService, PnlSnapshotsService],
})
export class TradeHistoriesModule {}

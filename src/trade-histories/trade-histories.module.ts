import { Module } from '@nestjs/common';
import { TradeHistoriesService } from './trade-histories.service';
import { TradeHistoriesResolver } from './trade-histories.resolver';
import { PnlSnapshotsService } from './pnlsnapshot.service';

@Module({
  providers: [
    TradeHistoriesResolver,
    TradeHistoriesService,
    PnlSnapshotsService,
  ],
  exports: [TradeHistoriesService, PnlSnapshotsService],
})
export class TradeHistoriesModule {}

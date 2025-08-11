import { Module } from '@nestjs/common';

import { TradeHistoriesService } from './trade-histories.service';
import { TradeHistoriesResolver } from './trade-histories.resolver';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { BacktestService } from './backtest.service';

@Module({
  providers: [
    TradeHistoriesResolver,
    TradeHistoriesService,
    PnlSnapshotsService,
    BacktestService,
  ],
  exports: [TradeHistoriesService, PnlSnapshotsService],
})
export class TradeHistoriesModule {}

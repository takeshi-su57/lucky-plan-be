import { Module } from '@nestjs/common';

import { LogsModule } from 'src/loggers/logs.module';

import { TradeHistoriesService } from './trade-histories.service';
import { TradeHistoriesResolver } from './trade-histories.resolver';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { BacktestService } from './backtest.service';

@Module({
  imports: [LogsModule],
  providers: [
    TradeHistoriesResolver,
    TradeHistoriesService,
    PnlSnapshotsService,
    BacktestService,
  ],
  exports: [TradeHistoriesService, PnlSnapshotsService, BacktestService],
})
export class TradeHistoriesModule {}

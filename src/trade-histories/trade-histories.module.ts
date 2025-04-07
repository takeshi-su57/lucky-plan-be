import { Module } from '@nestjs/common';

import { LogsModule } from 'src/loggers/logs.module';

import { TradeHistoriesService } from './trade-histories.service';
import { TradeHistoriesResolver } from './trade-histories.resolver';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { BacktestService } from './backtest.service';
import { BacktestV2Service } from './backtestV2.service';

@Module({
  imports: [LogsModule],
  providers: [
    TradeHistoriesResolver,
    TradeHistoriesService,
    PnlSnapshotsService,
    BacktestService,
    BacktestV2Service,
  ],
  exports: [TradeHistoriesService, PnlSnapshotsService, BacktestService],
})
export class TradeHistoriesModule {}

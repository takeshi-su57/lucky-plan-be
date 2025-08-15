import { Module } from '@nestjs/common';

import { TradeHistoriesService } from './trade-histories.service';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { BacktestService } from './backtest.service';
import { EventLogsService } from './event-logs.service';
import { PnlSnapshotsV2Service } from './pnlsnapshotV2.service';

import { TradeHistoriesResolver } from './trade-histories.resolver';
import { EventLogsResolver } from './event-logs.resolver';

@Module({
  providers: [
    EventLogsResolver,
    TradeHistoriesResolver,
    TradeHistoriesService,
    PnlSnapshotsService,
    PnlSnapshotsV2Service,
    BacktestService,
  ],
  exports: [
    TradeHistoriesService,
    EventLogsService,
    PnlSnapshotsService,
    PnlSnapshotsV2Service,
    BacktestService,
  ],
})
export class TradeHistoriesModule {}

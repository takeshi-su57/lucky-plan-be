import { Module } from '@nestjs/common';

import { GnsModule } from 'src/web3/platform/gns/gns.module';

import { TradeHistoriesService } from './trade-histories.service';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { EventLogsService } from './event-logs.service';

import { TradeHistoriesResolver } from './trade-histories.resolver';
import { EventLogsResolver } from './event-logs.resolver';
import { BacktestService } from './backtest.service';

@Module({
  imports: [GnsModule],
  providers: [
    TradeHistoriesResolver,
    TradeHistoriesService,
    EventLogsResolver,
    EventLogsService,
    PnlSnapshotsService,
    PnlSnapshotsService,
    BacktestService,
  ],
  exports: [
    TradeHistoriesService,
    EventLogsService,
    PnlSnapshotsService,
    PnlSnapshotsService,
    BacktestService,
  ],
})
export class TradeHistoriesModule {}

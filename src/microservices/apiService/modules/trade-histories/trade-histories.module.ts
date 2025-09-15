import { Module } from '@nestjs/common';

import { GnsModule } from 'src/web3/platform/gns/gns.module';

import { TradeHistoriesService } from './trade-histories.service';
import { PnlSnapshotsService } from './pnlsnapshot.service';
import { BacktestService } from './backtest.service';
import { EventLogsService } from './event-logs.service';
import { PnlSnapshotsV2Service } from './pnlsnapshotV2.service';

import { TradeHistoriesResolver } from './trade-histories.resolver';
import { EventLogsResolver } from './event-logs.resolver';
import { BacktestV2Service } from './backtest-v2.service';

@Module({
  imports: [GnsModule],
  providers: [
    TradeHistoriesResolver,
    TradeHistoriesService,
    EventLogsResolver,
    EventLogsService,
    PnlSnapshotsService,
    PnlSnapshotsV2Service,
    BacktestService,
    BacktestV2Service,
  ],
  exports: [
    TradeHistoriesService,
    EventLogsService,
    PnlSnapshotsService,
    PnlSnapshotsV2Service,
    BacktestService,
    BacktestV2Service,
  ],
})
export class TradeHistoriesModule {}

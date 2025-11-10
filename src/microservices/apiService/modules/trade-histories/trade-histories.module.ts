import { Module } from '@nestjs/common';

import { GnsModule } from 'src/web3/platform/gns/gns.module';

import { PnlSnapshotsService } from './pnlsnapshot.service';
import { EventLogsService } from './event-logs.service';
import { EventLogsResolver } from './event-logs.resolver';
import { BacktestService } from './backtest.service';

@Module({
  imports: [GnsModule],
  providers: [
    EventLogsResolver,
    EventLogsService,
    PnlSnapshotsService,
    PnlSnapshotsService,
    BacktestService,
  ],
  exports: [
    EventLogsService,
    PnlSnapshotsService,
    PnlSnapshotsService,
    BacktestService,
  ],
})
export class TradeHistoriesModule {}

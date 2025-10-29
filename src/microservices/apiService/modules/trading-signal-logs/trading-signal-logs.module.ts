import { Module } from '@nestjs/common';

import { TradingSignalLogsService } from './trading-signal-logs.service';
import { TradingSignalLogsResolver } from './trading-signal-logs.resolver';
import { TradingSignalLogsController } from './trading-signal-logs.controller';

@Module({
  controllers: [TradingSignalLogsController],
  providers: [TradingSignalLogsService, TradingSignalLogsResolver],
  exports: [TradingSignalLogsService],
})
export class TradingSignalLogsModule {}

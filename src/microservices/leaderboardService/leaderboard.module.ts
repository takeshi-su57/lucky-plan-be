import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { LeaderboardController } from './leaderboard.controller';

import { GlobalModule } from '../../global/global.module';
import { ContractsModule } from '../apiService/modules/contracts/contracts.module';
import { TradeHistoriesModule } from '../apiService/modules/trade-histories/trade-histories.module';

import { ContractMonitorService } from './contract-monitor.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GlobalModule,
    ContractsModule,
    TradeHistoriesModule,
  ],
  controllers: [LeaderboardController],
  providers: [ContractMonitorService],
})
export class LeaderboardModule {}

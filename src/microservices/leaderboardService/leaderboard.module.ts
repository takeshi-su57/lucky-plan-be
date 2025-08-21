import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { LeaderboardController } from './leaderboard.controller';

import { GlobalModule } from '../../global/global.module';
import { ContractsModule } from '../apiService/modules/contracts/contracts.module';
import { TradeHistoriesModule } from '../apiService/modules/trade-histories/trade-histories.module';

import { LeaderboardService } from './leaderboard.service';
import { PlansModule } from '../apiService/modules/plans/plans.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { Web3Module } from 'src/web3/web3/web3.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GlobalModule,
    ContractsModule,
    TradeHistoriesModule,
    PlansModule,
    GnsModule,
    Web3Module,
  ],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
})
export class LeaderboardModule {}

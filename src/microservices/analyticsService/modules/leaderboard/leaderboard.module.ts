import { Module } from '@nestjs/common';

import { ContractsModule } from 'src/microservices/apiService/modules/contracts/contracts.module';
import { PlansModule } from 'src/microservices/apiService/modules/plans/plans.module';
import { TradeHistoriesModule } from 'src/microservices/apiService/modules/trade-histories/trade-histories.module';
import { AvntModule } from 'src/web3/platform/avnt/avnt.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { Web3Module } from 'src/web3/web3/web3.module';
import { LeaderboardController } from './leaderboard.controller';
import { LeaderboardService } from './leaderboard.service';

@Module({
  imports: [
    ContractsModule,
    TradeHistoriesModule,
    PlansModule,
    Web3Module,
    GnsModule,
    AvntModule,
  ],
  controllers: [LeaderboardController],
  providers: [LeaderboardService],
  exports: [LeaderboardService],
})
export class LeaderboardModule {}

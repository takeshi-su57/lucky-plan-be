import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { GlobalModule } from '../../global/global.module';
import { WalletAccountsModule } from '../apiService/modules/wallet-accounts/wallet-accounts.module';
import { FollowerModule } from '../apiService/modules/follower/follower.module';
import { StrategyModule } from '../apiService/modules/strategy/strategy.module';
import { ContractsModule } from '../apiService/modules/contracts/contracts.module';
import { BotsModule } from '../apiService/modules/bots/bots.module';
import { PositionsModule } from '../apiService/modules/positions/positions.module';
import { MissionsModule } from '../apiService/modules/missions/missions.module';
import { TasksModule } from '../apiService/modules/tasks/tasks.module';
import { ActionsModule } from '../apiService/modules/actions/actions.module';
import { FollowerActionsModule } from '../apiService/modules/follower-actions/follower-actions.module';
import { TradeHistoriesModule } from '../apiService/modules/trade-histories/trade-histories.module';
import { TaskExecutorModule } from '../apiService/modules/task-executor/task-executor.module';
import { PlansModule } from '../apiService/modules/plans/plans.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { Web3Module } from 'src/web3/web3/web3.module';

import { TradingService } from './trading.service';

import { TradingController } from './trading.controller';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GlobalModule,
    WalletAccountsModule,
    FollowerModule,
    StrategyModule,
    ContractsModule,
    BotsModule,
    PositionsModule,
    MissionsModule,
    TasksModule,
    ActionsModule,
    FollowerActionsModule,
    TradeHistoriesModule,
    TaskExecutorModule,
    PlansModule,
    GnsModule,
    Web3Module,
  ],
  controllers: [TradingController],
  providers: [TradingService],
})
export class TradingModule {}

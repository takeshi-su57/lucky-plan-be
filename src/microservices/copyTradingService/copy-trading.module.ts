import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { GlobalModule } from '../../global/global.module';
import { FollowerModule } from '../apiService/modules/follower/follower.module';
import { StrategyModule } from '../apiService/modules/strategy/strategy.module';
import { ContractsModule } from '../apiService/modules/contracts/contracts.module';
import { BotsModule } from '../apiService/modules/bots/bots.module';
import { MissionsModule } from '../apiService/modules/missions/missions.module';
import { TasksModule } from '../apiService/modules/tasks/tasks.module';
import { ActionsModule } from '../apiService/modules/actions/actions.module';
import { FollowerActionsModule } from '../apiService/modules/follower-actions/follower-actions.module';
import { TradeHistoriesModule } from '../apiService/modules/trade-histories/trade-histories.module';
import { PlansModule } from '../apiService/modules/plans/plans.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { Web3Module } from 'src/web3/web3/web3.module';
import { PricesModule } from '../apiService/modules/prices/prices.module';
import { SLTPModule } from '../apiService/modules/sltp/sltp.module';

import { CopyTradingController } from './copy-trading.controller';

import { ActionRouterService } from './components/action-router.service';
import { CopyTradingService } from './copy-trading.service';
import { ContractMonitorService } from './components/contract-monitor.service';
import { MissionRouterService } from './components/mission-router.service';
import { TaskExecutorService } from './components/task-executor.service';
import { TaskLifecycleService } from './components/task-lifecycle.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GlobalModule,
    FollowerModule,
    StrategyModule,
    ContractsModule,
    BotsModule,
    MissionsModule,
    TasksModule,
    ActionsModule,
    FollowerActionsModule,
    TradeHistoriesModule,
    PlansModule,
    GnsModule,
    Web3Module,
    SLTPModule,
    PricesModule,
  ],
  providers: [
    ContractMonitorService,
    ActionRouterService,
    MissionRouterService,
    TaskLifecycleService,
    TaskExecutorService,
    CopyTradingService,
  ],
  controllers: [CopyTradingController],
})
export class CopyTradingModule {}

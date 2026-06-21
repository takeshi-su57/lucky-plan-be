import { Module } from '@nestjs/common';

import { ActionsModule } from 'src/microservices/apiService/modules/actions/actions.module';
import { ContractsModule } from 'src/microservices/apiService/modules/contracts/contracts.module';
import { FollowerActionsModule } from 'src/microservices/apiService/modules/follower-actions/follower-actions.module';
import { MissionsModule } from 'src/microservices/apiService/modules/missions/missions.module';
import { TasksModule } from 'src/microservices/apiService/modules/tasks/tasks.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { Web3Module } from 'src/web3/web3/web3.module';

import { ActionRouterService } from './components/action-router.service';
import { CopyTradingService } from './copy-trading.service';
import { ContractMonitorService } from './components/contract-monitor.service';
import { MissionRouterService } from './components/mission-router.service';
import { TaskExecutorService } from './components/task-executor.service';
import { TaskLifecycleService } from './components/task-lifecycle.service';

@Module({
  imports: [
    ActionsModule,
    ContractsModule,
    FollowerActionsModule,
    GnsModule,
    MissionsModule,
    TasksModule,
    Web3Module,
  ],
  providers: [
    ContractMonitorService,
    ActionRouterService,
    MissionRouterService,
    TaskLifecycleService,
    TaskExecutorService,
    CopyTradingService,
  ],
  exports: [
    CopyTradingService,
    ContractMonitorService,
    ActionRouterService,
    MissionRouterService,
    TaskLifecycleService,
    TaskExecutorService,
  ],
})
export class CopyTradingSystemModule {}

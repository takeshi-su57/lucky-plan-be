import { Module } from '@nestjs/common';

import { TasksModule } from 'src/microservices/apiService/modules/tasks/tasks.module';
import { MissionsModule } from 'src/microservices/apiService/modules/missions/missions.module';
import { FollowerModule } from 'src/microservices/apiService/modules/follower/follower.module';
import { ActionsModule } from 'src/microservices/apiService/modules/actions/actions.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { GmxModule } from 'src/web3/platform/gmx/gmx.module';
import { Web3Module } from 'src/web3/web3/web3.module';

import { TaskExecutorService } from './task-executor.service';
import { TaskExecutorResolver } from './task-executor.resolver';

@Module({
  imports: [
    TasksModule,
    MissionsModule,
    ActionsModule,
    FollowerModule,
    GnsModule,
    GmxModule,
    Web3Module,
  ],
  providers: [TaskExecutorResolver, TaskExecutorService],
  exports: [TaskExecutorService],
})
export class TaskExecutorModule {}

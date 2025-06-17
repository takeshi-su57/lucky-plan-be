import { Module } from '@nestjs/common';

import { TasksModule } from 'src/tasks/tasks.module';
import { MissionsModule } from 'src/missions/missions.module';
import { LogsModule } from 'src/loggers/logs.module';
import { FollowerModule } from 'src/follower/follower.module';
import { ActionsModule } from 'src/actions/actions.module';

import { TaskExecutorService } from './task-executor.service';
import { TaskExecutorResolver } from './task-executor.resolver';

@Module({
  imports: [
    TasksModule,
    MissionsModule,
    ActionsModule,
    FollowerModule,
    LogsModule,
  ],
  providers: [TaskExecutorResolver, TaskExecutorService],
  exports: [TaskExecutorService],
})
export class TaskExecutorModule {}

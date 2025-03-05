import { Module } from '@nestjs/common';

import { LogsModule } from 'src/loggers/logs.module';
import { ActionsModule } from 'src/actions/actions.module';
import { FollowerActionsModule } from 'src/follower-actions/follower-actions.module';

import { TasksService } from './tasks.service';
import { TasksResolver } from './tasks.resolver';

@Module({
  imports: [FollowerActionsModule, ActionsModule, LogsModule],
  providers: [TasksResolver, TasksService],
  exports: [TasksService],
})
export class TasksModule {}

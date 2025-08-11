import { Module } from '@nestjs/common';

import { ActionsModule } from 'src/microservices/apiService/modules/actions/actions.module';
import { FollowerActionsModule } from 'src/microservices/apiService/modules/follower-actions/follower-actions.module';

import { TasksService } from './tasks.service';
import { TasksResolver } from './tasks.resolver';

@Module({
  imports: [FollowerActionsModule, ActionsModule],
  providers: [TasksResolver, TasksService],
  exports: [TasksService],
})
export class TasksModule {}

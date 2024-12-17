import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksResolver } from './tasks.resolver';
import { FollowerActionsModule } from 'src/follower-actions/follower-actions.module';
import { ActionsModule } from 'src/actions/actions.module';

@Module({
  imports: [FollowerActionsModule, ActionsModule],
  providers: [TasksResolver, TasksService],
  exports: [TasksService],
})
export class TasksModule {}

import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksResolver } from './tasks.resolver';
import { FollowerActionsModule } from 'src/follower-actions/follower-actions.module';

@Module({
  imports: [FollowerActionsModule],
  providers: [TasksResolver, TasksService],
  exports: [TasksService],
})
export class TasksModule {}

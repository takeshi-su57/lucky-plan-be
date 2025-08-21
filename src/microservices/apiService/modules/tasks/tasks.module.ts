import { Module } from '@nestjs/common';

import { ActionsModule } from 'src/microservices/apiService/modules/actions/actions.module';
import { FollowerActionsModule } from 'src/microservices/apiService/modules/follower-actions/follower-actions.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';

import { TasksService } from './tasks.service';
import { TasksResolver } from './tasks.resolver';
import { TasksController } from './tasks.controller';

@Module({
  imports: [FollowerActionsModule, ActionsModule, GnsModule],
  controllers: [TasksController],
  providers: [TasksResolver, TasksService],
  exports: [TasksService],
})
export class TasksModule {}

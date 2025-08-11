import { Controller, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { EventPattern, Payload } from '@nestjs/microservices';

import { PUB_SUB } from 'src/global/global.module';
import { PATTERNS, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { TaskBackwardDetails } from './entities/task.entity';

@Controller()
export class TasksController {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}

  @EventPattern(PATTERNS.Tasks.TaskCreated)
  async handleTaskCreated(@Payload() tasks: TaskBackwardDetails[]) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.taskCreated, {
      [SUBSCRIPTION_TOKEN.taskCreated]: tasks,
    });
  }

  @EventPattern(PATTERNS.Tasks.TaskUpdated)
  async handleTaskUpdated(@Payload() tasks: TaskBackwardDetails[]) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.taskUpdated, {
      [SUBSCRIPTION_TOKEN.taskUpdated]: tasks,
    });
  }
}

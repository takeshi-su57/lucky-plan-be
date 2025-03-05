import { Inject } from '@nestjs/common';
import {
  Resolver,
  Args,
  Int,
  Subscription,
  Mutation,
  Query,
} from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';

import { TasksService } from './tasks.service';
import { TaskBackwardDetails } from './entities/task.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Resolver()
export class TasksResolver {
  constructor(
    private readonly tasksService: TasksService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => Boolean)
  stopTask(@Args('id', { type: () => Int }) id: number) {
    return this.tasksService.stopTask(id);
  }

  @Query(() => [TaskBackwardDetails])
  async getAlertTasks() {
    return this.tasksService.getAlertTasks();
  }

  @Subscription(() => [TaskBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.taskCreated,
  })
  subscribeToTaskCreated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskCreated);
  }

  @Subscription(() => [TaskBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.taskUpdated,
  })
  subscribeToTaskUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskUpdated);
  }
}

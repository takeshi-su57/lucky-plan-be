import { Inject } from '@nestjs/common';
import {
  Resolver,
  Query,
  Args,
  Int,
  Subscription,
  Mutation,
} from '@nestjs/graphql';
import { PubSub } from 'graphql-subscriptions';

import { TasksService } from './tasks.service';
import { TaskWithActions, TaskShallowDetails } from './entities/task.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { TaskStatus } from '@prisma/client';

@Resolver(() => TaskShallowDetails)
export class TasksResolver {
  constructor(
    private readonly tasksService: TasksService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => TaskShallowDetails, { nullable: true })
  stopTask(@Args('id', { type: () => Int }) id: number) {
    return this.tasksService.stopTask(id);
  }

  @Query(() => [TaskShallowDetails])
  getAllTasks() {
    return this.tasksService.findAll();
  }

  @Query(() => [TaskShallowDetails])
  getTasksByStatus(
    @Args('status', { type: () => TaskStatus }) status: TaskStatus,
  ) {
    return this.tasksService.findByStatus(status);
  }

  @Query(() => TaskWithActions, { nullable: true })
  findTask(@Args('id', { type: () => Int }) id: number) {
    return this.tasksService.findOne(id);
  }

  @Subscription(() => [TaskShallowDetails], {
    name: SUBSCRIPTION_TOKEN.taskAdded,
  })
  subscribeToTaskAdded() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskAdded);
  }

  @Subscription(() => [TaskShallowDetails], {
    name: SUBSCRIPTION_TOKEN.taskUpdated,
  })
  subscribeToTaskUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskUpdated);
  }
}

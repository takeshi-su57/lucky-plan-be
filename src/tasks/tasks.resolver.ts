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
import { TaskShallowDetails } from './entities/task.entity';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Resolver(() => TaskShallowDetails)
export class TasksResolver {
  constructor(
    private readonly tasksService: TasksService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => TaskShallowDetails)
  performTask(@Args('id', { type: () => Int }) id: number) {
    return this.tasksService.performTaskById(id);
  }

  @Query(() => [TaskShallowDetails])
  getAllTasks() {
    return this.tasksService.findAll();
  }

  @Query(() => TaskShallowDetails)
  findTask(@Args('id', { type: () => Int }) id: number) {
    return this.tasksService.findOne(id);
  }

  @Query(() => [TaskShallowDetails])
  findTasksByMission(
    @Args('missionId', { type: () => Int }) missionId: number,
  ) {
    return this.tasksService.findByMission(missionId);
  }

  @Subscription(() => TaskShallowDetails, {
    name: SUBSCRIPTION_TOKEN.taskAdded,
  })
  subscribeToTaskAdded() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskAdded);
  }

  @Subscription(() => TaskShallowDetails, {
    name: SUBSCRIPTION_TOKEN.taskUpdated,
  })
  subscribeToTaskUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskUpdated);
  }
}

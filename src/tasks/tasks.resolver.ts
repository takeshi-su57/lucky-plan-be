import { Inject, UseGuards } from '@nestjs/common';
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
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { CurrentUser } from 'src/auth/user.decorator';

import { User } from 'src/auth/entities/auth.entity';
import { Roles } from 'src/auth/roles.decorator';
import { UserPermission } from '@prisma/client';
import { RolesGuard } from 'src/auth/gql-role.guard';

@Resolver()
export class TasksResolver {
  constructor(
    private readonly tasksService: TasksService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  stopTask(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.tasksService.stopTask(user.address, id);
  }

  @Query(() => [TaskBackwardDetails])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async getAlertTasks(@CurrentUser() user: User) {
    return this.tasksService.getAlertTasks(user.address);
  }

  @Subscription(() => [TaskBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.taskCreated,
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  subscribeToTaskCreated(@CurrentUser() _user: User) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskCreated);
  }

  @Subscription(() => [TaskBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.taskUpdated,
  })
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  subscribeToTaskUpdated(@CurrentUser() _user: User) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskUpdated);
  }
}

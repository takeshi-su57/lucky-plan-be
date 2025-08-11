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
import { GqlAuthGuard } from 'src/microservices/apiService/modules/auth/gql-auth.guard';
import { CurrentUser } from 'src/microservices/apiService/modules/auth/user.decorator';

import { User } from 'src/microservices/apiService/modules/auth/entities/auth.entity';
import { Roles } from 'src/microservices/apiService/modules/auth/roles.decorator';
import { UserPermission } from '@prisma/client';
import { RolesGuard } from 'src/microservices/apiService/modules/auth/gql-role.guard';

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
    filter: (payload, variables) => {
      if (payload.taskCreated.length > 0) {
        return (
          payload.taskCreated[0].mission.bot.plan.userId === variables.userId
        );
      }

      return false;
    },
  })
  subscribeToTaskCreated(
    @Args('userId', { type: () => String }) _userId: string,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskCreated);
  }

  @Subscription(() => [TaskBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.taskUpdated,
    filter: (payload, variables) => {
      if (payload.taskUpdated.length > 0) {
        return (
          payload.taskUpdated[0].mission.bot.plan.userId === variables.userId
        );
      }

      return false;
    },
  })
  subscribeToTaskUpdated(
    @Args('userId', { type: () => String }) _userId: string,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.taskUpdated);
  }
}

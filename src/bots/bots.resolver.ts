import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
} from '@nestjs/graphql';
import { Inject, UseGuards } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { BotStatus, User, UserPermission } from '@prisma/client';

import { BotsService } from './bots.service';
import { BotBackwardDetails, BotConnection } from './entities/bot.entity';
import { CreateBotInput, CreateBotAndStrategyInput } from './dto/bot.input';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';
import { CurrentUser } from 'src/auth/user.decorator';
import { RolesGuard } from 'src/auth/gql-role.guard';
import { Roles } from 'src/auth/roles.decorator';

@Resolver()
export class BotsResolver {
  constructor(
    private readonly botsService: BotsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => BotBackwardDetails)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  createBot(@Args('input') input: CreateBotInput, @CurrentUser() user: User) {
    return this.botsService.create(user.address, input);
  }

  @Mutation(() => [BotBackwardDetails])
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  batchCreateBots(
    @Args('input', { type: () => [CreateBotAndStrategyInput] })
    inputs: CreateBotAndStrategyInput[],
    @CurrentUser() user: User,
  ) {
    return this.botsService.batchCreateBots(user.address, inputs);
  }

  @Mutation(() => BotBackwardDetails)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  deleteBot(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.botsService.delete(user.address, id);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  liveBot(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.botsService.live(user.address, id);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  stopBot(
    @Args('id', { type: () => Int }) id: number,
    @CurrentUser() user: User,
  ) {
    return this.botsService.stop(user.address, id);
  }

  @Subscription(() => [BotBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.botCreated,
    filter: (payload, variables) => {
      if (payload.botCreated.length > 0) {
        return payload.botCreated[0].plan.userId === variables.userId;
      }

      return false;
    },
  })
  subscribeToBotCreated(
    @Args('userId', { type: () => String }) _userId: string,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.botCreated);
  }

  @Subscription(() => [BotBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.botUpdated,
    filter: (payload, variables) => {
      if (payload.botUpdated.length > 0) {
        return payload.botUpdated[0].plan.userId === variables.userId;
      }

      return false;
    },
  })
  subscribeToBotUpdated(
    @Args('userId', { type: () => String }) _userId: string,
  ) {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.botUpdated);
  }

  @Query(() => BotConnection)
  @Roles(UserPermission.Trader)
  @UseGuards(GqlAuthGuard, RolesGuard)
  getBotsByStatus(
    @Args('status', { type: () => BotStatus }) status: BotStatus,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
    @CurrentUser() user: User,
  ) {
    return this.botsService.findByStatus(user.address, status, first, after);
  }
}

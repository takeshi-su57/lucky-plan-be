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
import { BotStatus } from '@prisma/client';

import { BotsService } from './bots.service';
import { BotBackwardDetails, BotConnection } from './entities/bot.entity';
import { CreateBotInput, CreateBotAndStrategyInput } from './dto/bot.input';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { GqlAuthGuard } from 'src/auth/gql-auth.guard';

@Resolver()
export class BotsResolver {
  constructor(
    private readonly botsService: BotsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => BotBackwardDetails)
  @UseGuards(GqlAuthGuard)
  createBot(@Args('input') input: CreateBotInput) {
    return this.botsService.create(input);
  }

  @Mutation(() => [BotBackwardDetails])
  @UseGuards(GqlAuthGuard)
  batchCreateBots(
    @Args('input', { type: () => [CreateBotAndStrategyInput] })
    inputs: CreateBotAndStrategyInput[],
  ) {
    return this.botsService.batchCreateBots(inputs);
  }

  @Mutation(() => BotBackwardDetails)
  @UseGuards(GqlAuthGuard)
  deleteBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.delete(id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  liveBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.live(id);
  }

  @Mutation(() => Boolean)
  @UseGuards(GqlAuthGuard)
  stopBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.stop(id);
  }

  @Subscription(() => [BotBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.botCreated,
  })
  @UseGuards(GqlAuthGuard)
  subscribeToBotCreated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.botCreated);
  }

  @Subscription(() => [BotBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.botUpdated,
  })
  @UseGuards(GqlAuthGuard)
  subscribeToBotUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.botUpdated);
  }

  @Query(() => BotConnection)
  @UseGuards(GqlAuthGuard)
  getBotsByStatus(
    @Args('status', { type: () => BotStatus }) status: BotStatus,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.botsService.findByStatus(status, first, after);
  }
}

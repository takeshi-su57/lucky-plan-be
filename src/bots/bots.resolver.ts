import {
  Resolver,
  Query,
  Mutation,
  Args,
  Int,
  Subscription,
} from '@nestjs/graphql';
import { Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { BotStatus } from '@prisma/client';

import { BotsService } from './bots.service';
import { BotBackwardDetails, BotConnection } from './entities/bot.entity';
import { CreateBotInput, CreateBotAndStrategyInput } from './dto/bot.input';

import { PUB_SUB } from 'src/global/global.module';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Resolver()
export class BotsResolver {
  constructor(
    private readonly botsService: BotsService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
  ) {}

  @Mutation(() => BotBackwardDetails)
  createBot(@Args('input') input: CreateBotInput) {
    return this.botsService.create(input);
  }

  @Mutation(() => [BotBackwardDetails])
  batchCreateBots(
    @Args('input', { type: () => [CreateBotAndStrategyInput] })
    inputs: CreateBotAndStrategyInput[],
  ) {
    return this.botsService.batchCreateBots(inputs);
  }

  @Mutation(() => BotBackwardDetails)
  deleteBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.delete(id);
  }

  @Mutation(() => Boolean)
  liveBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.live(id);
  }

  @Mutation(() => Boolean)
  stopBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.stop(id);
  }

  @Subscription(() => [BotBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.botCreated,
  })
  subscribeToBotCreated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.botCreated);
  }

  @Subscription(() => [BotBackwardDetails], {
    name: SUBSCRIPTION_TOKEN.botUpdated,
  })
  subscribeToBotUpdated() {
    return this.pubSub.asyncIterableIterator(SUBSCRIPTION_TOKEN.botUpdated);
  }

  @Query(() => BotConnection)
  getBotsByStatus(
    @Args('status', { type: () => BotStatus }) status: BotStatus,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.botsService.findByStatus(status, first, after);
  }
}

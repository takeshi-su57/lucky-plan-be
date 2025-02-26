import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { BotsService } from './bots.service';
import {
  Bot,
  BotDeepDetailsConnection,
  BotDeepDetails,
} from './entities/bot.entity';
import { CreateBotInput, CreateBotAndStrategyInput } from './dto/bot.input';
import { BotStatus } from '@prisma/client';

@Resolver(() => Bot)
export class BotsResolver {
  constructor(private readonly botsService: BotsService) {}

  @Mutation(() => BotDeepDetails)
  createBot(@Args('input') input: CreateBotInput) {
    return this.botsService.create(input);
  }

  @Mutation(() => [BotDeepDetails])
  batchCreateBots(
    @Args('input', { type: () => [CreateBotAndStrategyInput] })
    inputs: CreateBotAndStrategyInput[],
  ) {
    return this.botsService.batchCreateBots(inputs);
  }

  @Mutation(() => Int)
  deleteBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.delete(id);
  }

  @Mutation(() => BotDeepDetails)
  liveBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.live(id);
  }

  @Mutation(() => BotDeepDetails)
  stopBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.stop(id);
  }

  @Query(() => BotDeepDetailsConnection)
  getBotsByStatus(
    @Args('status', { type: () => BotStatus }) status: BotStatus,
    @Args('first', { type: () => Int }) first: number,
    @Args('after', { type: () => Int, nullable: true }) after: number | null,
  ) {
    return this.botsService.findByStatus(status, first, after);
  }
}

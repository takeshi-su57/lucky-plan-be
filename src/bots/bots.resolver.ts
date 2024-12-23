import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { BotsService } from './bots.service';
import { Bot, BotDetails, BotWithMissions } from './entities/bot.entity';
import { CreateBotInput } from './dto/bot.input';

@Resolver(() => Bot)
export class BotsResolver {
  constructor(private readonly botsService: BotsService) {}

  @Mutation(() => BotDetails)
  createBot(@Args('input') input: CreateBotInput) {
    return this.botsService.create(input);
  }

  @Mutation(() => Int)
  deleteBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.delete(id);
  }

  @Mutation(() => BotDetails)
  liveBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.live(id);
  }

  @Mutation(() => BotDetails)
  stopBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.stop(id);
  }

  @Query(() => [BotDetails])
  getAllBots() {
    return this.botsService.findAll();
  }

  @Query(() => BotWithMissions, { nullable: true })
  findBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.findBotWithMissions(id);
  }
}

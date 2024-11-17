import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { BotsService } from './bots.service';
import { Bot, BotDetails } from './entities/bot.entity';
import { CreateBotInput } from './dto/bot.input';

@Resolver(() => Bot)
export class BotsResolver {
  constructor(private readonly botsService: BotsService) {}

  @Mutation(() => Bot)
  createBot(@Args('input') input: CreateBotInput) {
    return this.botsService.create(input);
  }

  @Query(() => [Bot])
  findAllBots() {
    return this.botsService.findAll();
  }

  @Query(() => BotDetails)
  findBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.findOne(id);
  }
}

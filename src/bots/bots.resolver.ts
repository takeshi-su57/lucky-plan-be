import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { BotsService } from './bots.service';
import { Bot } from './entities/bot.entity';
import { CreateBotInput, UpdateBotInput } from './dto/bot.input';

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

  @Query(() => Bot, { nullable: true })
  findBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.findOne(id);
  }

  @Mutation(() => Bot, { nullable: true })
  updateBot(
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateBotInput,
  ) {
    return this.botsService.update(id, input);
  }

  @Mutation(() => Bot, { nullable: true })
  removeBot(@Args('id', { type: () => Int }) id: number) {
    return this.botsService.remove(id);
  }
}

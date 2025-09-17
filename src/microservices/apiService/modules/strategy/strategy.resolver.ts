import { Resolver, Query, Args, Int, Mutation } from '@nestjs/graphql';
import { StrategyService } from './strategy.service';
import { Strategy } from './entities/strategy.entity';
import { UpdateStrategyInput } from './dto/strategy.input';

@Resolver(() => Strategy)
export class StrategyResolver {
  constructor(private readonly strategyService: StrategyService) {}

  @Query(() => [Strategy])
  getAllStrategy() {
    return this.strategyService.findAll();
  }

  @Query(() => Strategy, { nullable: true })
  findStrategy(@Args('id', { type: () => Int }) id: number) {
    return this.strategyService.findOne(id);
  }

  @Mutation(() => Strategy)
  updateStrategy(
    @Args('id', { type: () => Int }) id: number,
    @Args('input', { type: () => UpdateStrategyInput })
    input: UpdateStrategyInput,
  ) {
    return this.strategyService.update(id, input);
  }
}

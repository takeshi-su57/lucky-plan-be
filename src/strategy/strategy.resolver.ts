import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { StrategyService } from './strategy.service';
import { Strategy } from './entities/strategy.entity';

import { CreateStrategyInput, UpdateStrategyInput } from './dto/strategy.input';

@Resolver(() => Strategy)
export class StrategyResolver {
  constructor(private readonly strategyService: StrategyService) {}

  @Mutation(() => Strategy)
  createStrategy(@Args('input') input: CreateStrategyInput) {
    return this.strategyService.create(input);
  }

  @Query(() => [Strategy])
  findAllStrategy() {
    return this.strategyService.findAll();
  }

  @Query(() => Strategy)
  findStrategy(@Args('id', { type: () => Int }) id: number) {
    return this.strategyService.findOne(id);
  }

  @Mutation(() => Strategy)
  updateStrategy(
    @Args('id', { type: () => Int }) id: number,
    @Args('input') input: UpdateStrategyInput,
  ) {
    return this.strategyService.update(id, input);
  }

  @Mutation(() => Strategy)
  removeStrategy(@Args('id', { type: () => Int }) id: number) {
    return this.strategyService.remove(id);
  }
}

import { Resolver, Query, Args, Int } from '@nestjs/graphql';
import { StrategyService } from './strategy.service';
import { Strategy } from './entities/strategy.entity';

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
}

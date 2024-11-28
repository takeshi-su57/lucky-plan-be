import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { StrategyMetadataService } from './strategy-metadata.service';
import { StrategyMetadata } from './entities/strategy-metadata.entity';
import { UpdateStrategyMetadataInput } from './dto/strategy-metadata.input';

@Resolver(() => StrategyMetadata)
export class StrategyMetadataResolver {
  constructor(private readonly strategyService: StrategyMetadataService) {}

  @Query(() => [StrategyMetadata])
  getAllStrategyMetadata() {
    return this.strategyService.findAll();
  }

  @Query(() => StrategyMetadata)
  findStrategyMetadata(@Args('key') key: string) {
    return this.strategyService.findOne(key);
  }

  @Mutation(() => StrategyMetadata)
  updateStrategyMetadata(
    @Args('key') key: string,
    @Args('input') input: UpdateStrategyMetadataInput,
  ) {
    return this.strategyService.update(key, input);
  }
}

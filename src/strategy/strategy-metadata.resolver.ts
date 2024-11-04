import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { StrategyMetadataService } from './strategy-metadata.service';
import { StrategyMetadata } from './entities/strategy-metadata.entity';
import {
  CreateStrategyMetadataInput,
  UpdateStrategyMetadataInput,
} from './dto/strategy-metadata.input';

@Resolver(() => StrategyMetadata)
export class StrategyMetadataResolver {
  constructor(private readonly strategyService: StrategyMetadataService) {}

  @Mutation(() => StrategyMetadata)
  createStrategyMetadata(@Args('input') input: CreateStrategyMetadataInput) {
    return this.strategyService.create(input);
  }

  @Query(() => [StrategyMetadata])
  findAllStrategyMetadata() {
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

  @Mutation(() => StrategyMetadata)
  removeStrategyMetadata(@Args('key') key: string) {
    return this.strategyService.remove(key);
  }
}

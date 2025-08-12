import { Resolver, Query, Args } from '@nestjs/graphql';

import { StrategyMetadataService } from './strategy-metadata.service';
import { StrategyMetadata } from './entities/strategy-metadata.entity';

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
}

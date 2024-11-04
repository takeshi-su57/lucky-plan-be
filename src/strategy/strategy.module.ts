import { Module } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { StrategyResolver } from './strategy.resolver';
import { StrategyMetadataService } from './strategy-metadata.service';
import { StrategyMetadataResolver } from './strategy-metadata.resolver';

@Module({
  providers: [
    StrategyResolver,
    StrategyService,
    StrategyMetadataResolver,
    StrategyMetadataService,
  ],
  exports: [StrategyService, StrategyMetadataService],
})
export class StrategyModule {}

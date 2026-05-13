import { Module } from '@nestjs/common';
import { StrategyService } from './strategy.service';
import { StrategyResolver } from './strategy.resolver';

@Module({
  providers: [StrategyResolver, StrategyService],
  exports: [StrategyService],
})
export class StrategyModule {}

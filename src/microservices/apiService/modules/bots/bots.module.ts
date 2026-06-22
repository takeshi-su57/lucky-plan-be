import { Module } from '@nestjs/common';

import { FollowerModule } from 'src/microservices/apiService/modules/follower/follower.module';
import { StrategyModule } from 'src/microservices/apiService/modules/strategy/strategy.module';

import { BotsService } from './bots.service';
import { BotsResolver } from './bots.resolver';
import { BotsController } from './bots.controller';
import { Web3Module } from 'src/web3/web3/web3.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';

@Module({
  imports: [FollowerModule, StrategyModule, Web3Module, GnsModule],
  controllers: [BotsController],
  providers: [BotsService, BotsResolver],
  exports: [BotsService],
})
export class BotsModule {}

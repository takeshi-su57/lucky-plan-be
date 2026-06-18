import { Module } from '@nestjs/common';

import { BotsModule } from 'src/microservices/apiService/modules/bots/bots.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';

import { PlansService } from './plans.service';
import { PlansResolver } from './plans.resolver';
import { PlansController } from './plans.controller';

@Module({
  imports: [BotsModule, GnsModule],
  controllers: [PlansController],
  providers: [PlansResolver, PlansService],
  exports: [PlansService],
})
export class PlansModule {}

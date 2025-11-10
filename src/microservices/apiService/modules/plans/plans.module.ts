import { Module } from '@nestjs/common';

import { BotsModule } from 'src/microservices/apiService/modules/bots/bots.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';

import { PlansService } from './plans.service';
import { PlansResolver } from './plans.resolver';
import { PlansController } from './plans.controller';
import { AutoPlansService } from './autoplans.service';

@Module({
  imports: [BotsModule, GnsModule],
  controllers: [PlansController],
  providers: [PlansResolver, PlansService, AutoPlansService],
  exports: [PlansService, AutoPlansService],
})
export class PlansModule {}

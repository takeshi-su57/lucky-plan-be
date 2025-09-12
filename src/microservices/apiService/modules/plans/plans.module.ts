import { Module } from '@nestjs/common';

import { BotsModule } from 'src/microservices/apiService/modules/bots/bots.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';

import { PlansService } from './plans.service';
import { PlansResolver } from './plans.resolver';
import { AutoPlansService } from './autoplans.service';
import { PlansController } from './plans.controller';
import { AutoPlansV2Service } from './autoplansV2.service';

@Module({
  imports: [BotsModule, GnsModule],
  controllers: [PlansController],
  providers: [
    PlansResolver,
    PlansService,
    AutoPlansService,
    AutoPlansV2Service,
  ],
  exports: [PlansService, AutoPlansService, AutoPlansV2Service],
})
export class PlansModule {}

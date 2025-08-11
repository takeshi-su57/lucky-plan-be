import { Module } from '@nestjs/common';

import { BotsModule } from 'src/microservices/apiService/modules/bots/bots.module';

import { PlansService } from './plans.service';
import { PlansResolver } from './plans.resolver';
import { AutoPlansService } from './autoplans.service';
import { PlansController } from './plans.controller';

@Module({
  imports: [BotsModule],
  controllers: [PlansController],
  providers: [PlansResolver, PlansService, AutoPlansService],
  exports: [PlansService],
})
export class PlansModule {}

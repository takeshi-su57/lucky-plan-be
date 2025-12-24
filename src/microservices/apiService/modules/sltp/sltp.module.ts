import { Module } from '@nestjs/common';

import { PricesModule } from '../prices/prices.module';
import { FollowerModule } from '../follower/follower.module';

import { SLTPService } from './sltp.service';
import { SLTPResolver } from './sltp.resolver';

@Module({
  imports: [PricesModule, FollowerModule],
  providers: [SLTPService, SLTPResolver],
  exports: [SLTPService],
})
export class SLTPModule {}

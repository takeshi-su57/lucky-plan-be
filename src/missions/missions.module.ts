import { Module } from '@nestjs/common';

import { MissionsService } from './missions.service';
import { MissionsResolver } from './missions.resolver';

@Module({
  providers: [MissionsResolver, MissionsService],
  exports: [MissionsService],
})
export class MissionsModule {}

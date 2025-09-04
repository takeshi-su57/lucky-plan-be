import { Module } from '@nestjs/common';

import { GmxService } from './gmx.service';

@Module({
  controllers: [],
  providers: [GmxService],
  exports: [GmxService],
})
export class GmxModule {}

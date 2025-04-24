import { Module } from '@nestjs/common';

import { BotsModule } from 'src/bots/bots.module';
import { LogsModule } from 'src/loggers/logs.module';

import { PlansService } from './plans.service';
import { PlansResolver } from './plans.resolver';
import { AutoPlansService } from './autoplans.service';
import { AutoPlansV2Service } from './autoplansV2.service';

@Module({
  imports: [BotsModule, LogsModule],
  providers: [
    PlansResolver,
    PlansService,
    AutoPlansService,
    AutoPlansV2Service,
  ],
  exports: [PlansService, AutoPlansService, AutoPlansV2Service],
})
export class PlansModule {}

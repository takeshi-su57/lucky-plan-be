import { Module } from '@nestjs/common';

import { BotsModule } from 'src/bots/bots.module';
import { LogsModule } from 'src/loggers/logs.module';

import { PlansService } from './plans.service';
import { PlansResolver } from './plans.resolver';

@Module({
  imports: [BotsModule, LogsModule],
  providers: [PlansResolver, PlansService],
  exports: [PlansService],
})
export class PlansModule {}

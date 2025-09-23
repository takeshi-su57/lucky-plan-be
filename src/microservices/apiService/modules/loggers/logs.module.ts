import { Module } from '@nestjs/common';

import { LogsService } from './logs.service';
import { LogsResolver } from './logs.resolver';
import { LogsController } from './logs.controller';

@Module({
  providers: [LogsService, LogsResolver],
  controllers: [LogsController],
  exports: [LogsService],
})
export class LogsModule {}

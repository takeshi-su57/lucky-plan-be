import { Module } from '@nestjs/common';
import { LogsService } from './logs.service';
import { LogsResolver } from './logs.resolver';

@Module({
  providers: [LogsService, LogsResolver],
})
export class LogsModule {}

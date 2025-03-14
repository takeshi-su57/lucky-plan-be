import { Module } from '@nestjs/common';

import { TasksModule } from 'src/tasks/tasks.module';
import { LogsModule } from 'src/loggers/logs.module';

import { MissionsService } from './missions.service';
import { MissionsResolver } from './missions.resolver';

@Module({
  imports: [TasksModule, LogsModule],
  providers: [MissionsResolver, MissionsService],
  exports: [MissionsService],
})
export class MissionsModule {}

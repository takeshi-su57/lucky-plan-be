import { Module } from '@nestjs/common';

import { TasksModule } from 'src/tasks/tasks.module';

import { MissionsService } from './missions.service';
import { MissionsResolver } from './missions.resolver';

@Module({
  imports: [TasksModule],
  providers: [MissionsResolver, MissionsService],
  exports: [MissionsService],
})
export class MissionsModule {}

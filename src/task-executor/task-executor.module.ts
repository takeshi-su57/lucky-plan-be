import { Module } from '@nestjs/common';

import { TasksModule } from 'src/tasks/tasks.module';
import { MissionsModule } from 'src/missions/missions.module';

import { TaskExecutorService } from './task-executor.service';
import { TaskExecutorResolver } from './task-executor.resolver';

@Module({
  imports: [TasksModule, MissionsModule],
  providers: [TaskExecutorResolver, TaskExecutorService],
  exports: [TaskExecutorService],
})
export class TaskExecutorModule {}

import { Module } from '@nestjs/common';

import { TasksModule } from 'src/microservices/apiService/modules/tasks/tasks.module';

import { MissionsService } from './missions.service';
import { MissionsResolver } from './missions.resolver';
import { MissionsController } from './missions.controller';

@Module({
  imports: [TasksModule],
  controllers: [MissionsController],
  providers: [MissionsResolver, MissionsService],
  exports: [MissionsService],
})
export class MissionsModule {}

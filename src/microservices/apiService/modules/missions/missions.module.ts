import { Module } from '@nestjs/common';

import { TasksModule } from 'src/microservices/apiService/modules/tasks/tasks.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';

import { MissionsService } from './missions.service';
import { MissionsResolver } from './missions.resolver';
import { MissionsController } from './missions.controller';

@Module({
  imports: [TasksModule, GnsModule],
  controllers: [MissionsController],
  providers: [MissionsResolver, MissionsService],
  exports: [MissionsService],
})
export class MissionsModule {}

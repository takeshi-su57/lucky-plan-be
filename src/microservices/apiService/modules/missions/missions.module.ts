import { Module } from '@nestjs/common';

import { TasksModule } from 'src/microservices/apiService/modules/tasks/tasks.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { GmxModule } from 'src/web3/platform/gmx/v2/gmx.module';

import { MissionsService } from './missions.service';
import { MissionsResolver } from './missions.resolver';
import { MissionsController } from './missions.controller';

@Module({
  imports: [TasksModule, GnsModule, GmxModule],
  controllers: [MissionsController],
  providers: [MissionsResolver, MissionsService],
  exports: [MissionsService],
})
export class MissionsModule {}

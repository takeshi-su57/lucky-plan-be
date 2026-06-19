import { Module } from '@nestjs/common';

import { BotsModule } from 'src/microservices/apiService/modules/bots/bots.module';
import { TasksModule } from 'src/microservices/apiService/modules/tasks/tasks.module';
import { GnsModule } from 'src/web3/platform/gns/gns.module';
import { Web3Module } from 'src/web3/web3/web3.module';

import { PlansService } from './plans.service';
import { PlanSimulationService } from './plan-simulation.service';
import { SimulationTaskExecutorService } from './simulation-task-executor.service';
import { PlansResolver } from './plans.resolver';
import { PlansController } from './plans.controller';

@Module({
  imports: [BotsModule, TasksModule, GnsModule, Web3Module],
  controllers: [PlansController],
  providers: [
    PlansResolver,
    PlansService,
    PlanSimulationService,
    SimulationTaskExecutorService,
  ],
  exports: [PlansService],
})
export class PlansModule {}

import { Module } from '@nestjs/common';

import { SimulationEvaluatorTaskService } from './simulation-evaluator-task.service';

@Module({
  providers: [SimulationEvaluatorTaskService],
  exports: [SimulationEvaluatorTaskService],
})
export class SimulationEvaluatorModule {}

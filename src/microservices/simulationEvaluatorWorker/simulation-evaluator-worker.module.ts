import { Module } from '@nestjs/common';

import { SimulationEvaluatorWorkerCacheService } from './simulation-evaluator-worker-cache.service';
import { SimulationEvaluatorWorkerClientService } from './simulation-evaluator-worker-client.service';
import { SimulationEvaluatorWorkerEvaluationService } from './simulation-evaluator-worker-evaluation.service';
import { SimulationEvaluatorWorkerRuntimeService } from './simulation-evaluator-worker-runtime.service';

@Module({
  providers: [
    SimulationEvaluatorWorkerCacheService,
    SimulationEvaluatorWorkerClientService,
    SimulationEvaluatorWorkerEvaluationService,
    SimulationEvaluatorWorkerRuntimeService,
  ],
})
export class SimulationEvaluatorWorkerModule {}

import { Module } from '@nestjs/common';

import { TradeHistoriesModule } from 'src/microservices/apiService/modules/trade-histories/trade-histories.module';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationCacheService } from './simulation-cache.service';
import { SimulationLeaderEvaluatorService } from './simulation-leader-evaluator.service';
import { DistributedSimulationEvaluatorService } from './distributed-simulation-evaluator.service';
import { SimulationDynamicAutoSchedulerService } from './simulation-dynamic-auto-scheduler.service';
import { SimulationDynamicAutomationCronService } from './simulation-dynamic-automation-cron.service';
import { SimulationEvaluatorModule } from '../simulationEvaluator/simulation-evaluator.module';

@Module({
  imports: [TradeHistoriesModule, SimulationEvaluatorModule],
  providers: [
    SimulationAutoRunnerService,
    SimulationLeaderEvaluatorService,
    SimulationCacheService,
    DistributedSimulationEvaluatorService,
    SimulationDynamicAutoSchedulerService,
    SimulationDynamicAutomationCronService,
  ],
})
export class AnalyticsSimulationsModule {}

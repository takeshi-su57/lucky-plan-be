import { Module } from '@nestjs/common';

import { TradeHistoriesModule } from 'src/microservices/apiService/modules/trade-histories/trade-histories.module';
import { AnalyticsSimulationResearchService } from './analytics-simulation-research.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationCacheService } from './simulation-cache.service';
import { SimulationLeaderEventLogCacheService } from './simulation-leader-event-log-cache.service';
import { SimulationLeaderEvaluatorService } from './simulation-leader-evaluator.service';
import { SimulationResearchAutoRunnerService } from './simulation-research-auto-runner.service';
import { SimulationResearchAutomationCronService } from './simulation-research-automation-cron.service';
import { DistributedSimulationEvaluatorService } from './distributed-simulation-evaluator.service';
import { SimulationEvaluatorModule } from '../simulationEvaluator/simulation-evaluator.module';

@Module({
  imports: [TradeHistoriesModule, SimulationEvaluatorModule],
  providers: [
    SimulationResearchAutomationCronService,
    SimulationAutoRunnerService,
    SimulationResearchAutoRunnerService,
    SimulationLeaderEvaluatorService,
    SimulationLeaderEventLogCacheService,
    AnalyticsSimulationResearchService,
    SimulationCacheService,
    DistributedSimulationEvaluatorService,
  ],
  exports: [AnalyticsSimulationResearchService],
})
export class AnalyticsSimulationsModule {}

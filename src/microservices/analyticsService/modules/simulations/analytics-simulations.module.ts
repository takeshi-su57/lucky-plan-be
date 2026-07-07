import { Module } from '@nestjs/common';

import { TradeHistoriesModule } from 'src/microservices/apiService/modules/trade-histories/trade-histories.module';
import { AnalyticsSimulationsService } from './analytics-simulations.service';
import { AnalyticsSimulationResearchService } from './analytics-simulation-research.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationAutomationCronService } from './simulation-automation-cron.service';
import { SimulationCacheService } from './simulation-cache.service';
import { SimulationLeaderEventLogCacheService } from './simulation-leader-event-log-cache.service';
import { SimulationLeaderEvaluatorService } from './simulation-leader-evaluator.service';
import { SimulationResearchAutoRunnerService } from './simulation-research-auto-runner.service';
import { SimulationResearchAutomationCronService } from './simulation-research-automation-cron.service';

@Module({
  imports: [TradeHistoriesModule],
  providers: [
    SimulationAutomationCronService,
    SimulationResearchAutomationCronService,
    SimulationAutoRunnerService,
    SimulationResearchAutoRunnerService,
    SimulationLeaderEvaluatorService,
    SimulationLeaderEventLogCacheService,
    AnalyticsSimulationsService,
    AnalyticsSimulationResearchService,
    SimulationCacheService,
  ],
  exports: [AnalyticsSimulationsService, AnalyticsSimulationResearchService],
})
export class AnalyticsSimulationsModule {}

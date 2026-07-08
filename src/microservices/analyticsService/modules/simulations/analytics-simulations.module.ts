import { Module } from '@nestjs/common';

import { TradeHistoriesModule } from 'src/microservices/apiService/modules/trade-histories/trade-histories.module';
import { AnalyticsSimulationResearchService } from './analytics-simulation-research.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationCacheService } from './simulation-cache.service';
import { SimulationLeaderEventLogCacheService } from './simulation-leader-event-log-cache.service';
import { SimulationLeaderEvaluatorService } from './simulation-leader-evaluator.service';
import { SimulationResearchAutoRunnerService } from './simulation-research-auto-runner.service';
import { SimulationResearchAutomationCronService } from './simulation-research-automation-cron.service';

@Module({
  imports: [TradeHistoriesModule],
  providers: [
    SimulationResearchAutomationCronService,
    SimulationAutoRunnerService,
    SimulationResearchAutoRunnerService,
    SimulationLeaderEvaluatorService,
    SimulationLeaderEventLogCacheService,
    AnalyticsSimulationResearchService,
    SimulationCacheService,
  ],
  exports: [AnalyticsSimulationResearchService],
})
export class AnalyticsSimulationsModule {}

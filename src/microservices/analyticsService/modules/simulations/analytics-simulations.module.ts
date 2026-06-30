import { Module } from '@nestjs/common';

import { TradeHistoriesModule } from 'src/microservices/apiService/modules/trade-histories/trade-histories.module';
import { AnalyticsSimulationsService } from './analytics-simulations.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationAutomationCronService } from './simulation-automation-cron.service';
import { SimulationCacheService } from './simulation-cache.service';
import { SimulationLeaderEvaluatorService } from './simulation-leader-evaluator.service';

@Module({
  imports: [TradeHistoriesModule],
  providers: [
    SimulationAutomationCronService,
    SimulationAutoRunnerService,
    SimulationLeaderEvaluatorService,
    AnalyticsSimulationsService,
    SimulationCacheService,
  ],
  exports: [AnalyticsSimulationsService],
})
export class AnalyticsSimulationsModule {}

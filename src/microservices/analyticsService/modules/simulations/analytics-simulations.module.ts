import { Module } from '@nestjs/common';

import { TradeHistoriesModule } from 'src/microservices/apiService/modules/trade-histories/trade-histories.module';
import { SimulationsModule } from 'src/microservices/apiService/modules/simulations/simulations.module';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationCacheService } from './simulation-cache.service';
import { SimulationLeaderEvaluatorService } from './simulation-leader-evaluator.service';
import { DistributedSimulationEvaluatorService } from './distributed-simulation-evaluator.service';
import { SimulationDynamicAutoSchedulerService } from './simulation-dynamic-auto-scheduler.service';
import { SimulationDynamicAutomationCronService } from './simulation-dynamic-automation-cron.service';
import { SimulationEvaluatorModule } from '../simulationEvaluator/simulation-evaluator.module';
import { SimulationResearchReportService } from './research-report/simulation-research-report.service';
import { SimulationResearchReportCronService } from './simulation-research-report-cron.service';

@Module({
  imports: [TradeHistoriesModule, SimulationEvaluatorModule, SimulationsModule],
  providers: [
    SimulationAutoRunnerService,
    SimulationLeaderEvaluatorService,
    SimulationCacheService,
    DistributedSimulationEvaluatorService,
    SimulationDynamicAutoSchedulerService,
    SimulationDynamicAutomationCronService,
    SimulationResearchReportService,
    SimulationResearchReportCronService,
  ],
})
export class AnalyticsSimulationsModule {}

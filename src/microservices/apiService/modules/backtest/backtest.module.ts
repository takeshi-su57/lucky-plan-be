import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { WorkerPoolService } from 'src/backtest/workers/worker-pool.service';

import { BacktestService } from './backtest.service';
import { BacktestRunnerService } from './backtest-runner.service';
import { BacktestResolver } from './backtest.resolver';
import { BacktestController } from './backtest.controller';
import { OptunaDashboardService } from './optuna-dashboard.service';
import { StrategyTemplateService } from './strategy-template.service';
import { StrategyTemplateResolver } from './strategy-template.resolver';
import { TemplateSearchService } from './template-search.service';
import { TemplateSearchResolver } from './template-search.resolver';
import { ValidationPipelineService } from './validation-pipeline.service';
import { ThresholdFilterService } from './threshold-filter.service';
import { ParetoSelectionService } from './pareto-selection.service';
import { WalkForwardService } from './walk-forward.service';
import { RobustnessTestService } from './robustness-test.service';
import { ValidationRunnerService } from './validation-runner.service';
import { ValidationPipelineResolver } from './validation-pipeline.resolver';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [BacktestController],
  providers: [
    WorkerPoolService,
    BacktestService,
    BacktestRunnerService,
    BacktestResolver,
    OptunaDashboardService,
    StrategyTemplateService,
    StrategyTemplateResolver,
    TemplateSearchService,
    TemplateSearchResolver,
    // Validation pipeline services
    ValidationPipelineService,
    ThresholdFilterService,
    ParetoSelectionService,
    WalkForwardService,
    RobustnessTestService,
    ValidationRunnerService,
    ValidationPipelineResolver,
  ],
  exports: [
    BacktestService,
    BacktestRunnerService,
    OptunaDashboardService,
    StrategyTemplateService,
    TemplateSearchService,
    ValidationPipelineService,
  ],
})
export class BacktestModule {}

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
  ],
  exports: [
    BacktestService,
    BacktestRunnerService,
    OptunaDashboardService,
    StrategyTemplateService,
    TemplateSearchService,
  ],
})
export class BacktestModule {}

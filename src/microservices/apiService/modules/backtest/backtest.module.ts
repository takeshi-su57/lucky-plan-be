import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { WorkerPoolService } from 'src/backtest/workers/worker-pool.service';

import { BacktestService } from './backtest.service';
import { BacktestRunnerService } from './backtest-runner.service';
import { BacktestResolver } from './backtest.resolver';
import { BacktestController } from './backtest.controller';
import { OptunaDashboardService } from './optuna-dashboard.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [BacktestController],
  providers: [
    WorkerPoolService,
    BacktestService,
    BacktestRunnerService,
    BacktestResolver,
    OptunaDashboardService,
  ],
  exports: [BacktestService, BacktestRunnerService, OptunaDashboardService],
})
export class BacktestModule {}

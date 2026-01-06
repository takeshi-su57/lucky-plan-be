import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { BacktestService } from './backtest.service';
import { BacktestRunnerService } from './backtest-runner.service';
import { BacktestResolver } from './backtest.resolver';
import { BacktestController } from './backtest.controller';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [BacktestController],
  providers: [BacktestService, BacktestRunnerService, BacktestResolver],
  exports: [BacktestService, BacktestRunnerService],
})
export class BacktestModule {}

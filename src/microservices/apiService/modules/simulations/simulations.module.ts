import { Module } from '@nestjs/common';

import { SimulationsService } from './simulations.service';
import { SimulationsResolver } from './simulations.resolver';
import { TradeHistoriesModule } from '../trade-histories/trade-histories.module';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { SimulationLeaderEvaluatorService } from './simulation-leader-evaluator.service';
import { SimulationPlansService } from './simulation-plans.service';

@Module({
  imports: [TradeHistoriesModule],
  providers: [
    SimulationsResolver,
    SimulationsService,
    SimulationAutoRunnerService,
    SimulationLeaderEvaluatorService,
    SimulationPlansService,
  ],
  exports: [SimulationsService],
})
export class SimulationsModule {}

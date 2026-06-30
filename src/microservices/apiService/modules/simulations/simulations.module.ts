import { Module } from '@nestjs/common';

import { SimulationsService } from './simulations.service';
import { SimulationsResolver } from './simulations.resolver';
import { TradeHistoriesModule } from '../trade-histories/trade-histories.module';
import { SimulationPlansService } from './simulation-plans.service';

@Module({
  imports: [TradeHistoriesModule],
  providers: [SimulationsResolver, SimulationsService, SimulationPlansService],
  exports: [SimulationsService],
})
export class SimulationsModule {}

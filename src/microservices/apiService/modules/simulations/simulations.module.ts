import { Module } from '@nestjs/common';

import { SimulationsService } from './simulations.service';
import { SimulationsResolver } from './simulations.resolver';
import { TradeHistoriesModule } from '../trade-histories/trade-histories.module';

@Module({
  imports: [TradeHistoriesModule],
  providers: [SimulationsResolver, SimulationsService],
  exports: [SimulationsService],
})
export class SimulationsModule {}

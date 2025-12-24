import { Module } from '@nestjs/common';

import { PricesService } from './prices.service';
import { PricesResolver } from './prices.resolver';

@Module({
  providers: [PricesService, PricesResolver],
  exports: [PricesService],
})
export class PricesModule {}

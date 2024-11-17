import { Module, Global, Logger } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { TradeService } from './trade.service';
import { ChainsService } from './chains.service';
import { PriceService } from './price.service';

@Global()
@Module({
  providers: [PrismaService, TradeService, Logger, ChainsService, PriceService],
  exports: [PrismaService, TradeService, Logger, ChainsService, PriceService],
})
export class GlobalModule {}

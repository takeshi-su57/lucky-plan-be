import { Module, Global, Logger } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { TradeService } from './trade.service';
import { ChainsService } from './chains.service';
import { TradingVariableService } from './trading-variable.service';

@Global()
@Module({
  providers: [
    PrismaService,
    TradeService,
    Logger,
    ChainsService,
    TradingVariableService,
  ],
  exports: [
    PrismaService,
    TradeService,
    Logger,
    ChainsService,
    TradingVariableService,
  ],
})
export class GlobalModule {}

import { Module, Global, Logger } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { PrismaService } from './prisma.service';
import { TradeService } from './trade.service';
import { ChainsService } from './chains.service';
import { TradingVariableService } from './trading-variable.service';
import { SecurityService } from './security.service';

export const PUB_SUB = Symbol('PUB_SUB');

@Global()
@Module({
  providers: [
    PrismaService,
    TradeService,
    Logger,
    ChainsService,
    TradingVariableService,
    SecurityService,
    {
      provide: PUB_SUB,
      useValue: new PubSub(),
    },
  ],
  exports: [
    PrismaService,
    TradeService,
    Logger,
    ChainsService,
    TradingVariableService,
    SecurityService,
    PUB_SUB,
  ],
})
export class GlobalModule {}

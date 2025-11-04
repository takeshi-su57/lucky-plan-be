import { Controller, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { EventPattern, Payload } from '@nestjs/microservices';
import { TradingSignalLog } from './entities/trading-signal-logs.entity';
import { PUB_SUB } from 'src/global/global.module';
import { PATTERNS, SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Controller()
export class TradingSignalLogsController {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}

  @EventPattern(PATTERNS.TradingSignalLogs.TradingSignalLogUpdated)
  async handleTradingSignalLogUpdated(
    @Payload() tradingSignalLogs: TradingSignalLog[],
  ) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.tradingSignalLogUpdated, {
      [SUBSCRIPTION_TOKEN.tradingSignalLogUpdated]: tradingSignalLogs,
    });
  }
}

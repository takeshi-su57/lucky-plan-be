import { Controller, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { EventPattern, Payload } from '@nestjs/microservices';

import { PUB_SUB } from 'src/global/global.module';
import { PATTERNS, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { BacktestTask } from './entities';
import { BacktestResult } from './entities';

@Controller()
export class BacktestController {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}

  @EventPattern(PATTERNS.Backtest.TaskUpdated)
  async handleBacktestTaskUpdated(@Payload() task: BacktestTask) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.backtestTaskUpdated, {
      [SUBSCRIPTION_TOKEN.backtestTaskUpdated]: task,
    });
  }

  @EventPattern(PATTERNS.Backtest.ResultCreated)
  async handleBacktestResultCreated(@Payload() result: BacktestResult) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.backtestResultCreated, {
      [SUBSCRIPTION_TOKEN.backtestResultCreated]: result,
    });
  }
}

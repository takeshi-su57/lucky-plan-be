import { Controller, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { EventPattern, Payload } from '@nestjs/microservices';

import { PUB_SUB } from 'src/global/global.module';
import { PATTERNS, SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { BotBackwardDetails } from './entities/bot.entity';

@Controller()
export class BotsController {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}

  @EventPattern(PATTERNS.Bots.BotCreated)
  async handleBotCreated(@Payload() bots: BotBackwardDetails[]) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.botCreated, {
      [SUBSCRIPTION_TOKEN.botCreated]: bots,
    });
  }

  @EventPattern(PATTERNS.Bots.BotUpdated)
  async handleBotUpdated(@Payload() bots: BotBackwardDetails[]) {
    await this.pubSub.publish(SUBSCRIPTION_TOKEN.botUpdated, {
      [SUBSCRIPTION_TOKEN.botUpdated]: bots,
    });
  }
}

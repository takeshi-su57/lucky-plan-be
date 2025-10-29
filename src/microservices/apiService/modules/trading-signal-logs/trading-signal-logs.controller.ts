import { Controller, Inject } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { PUB_SUB } from 'src/global/global.module';

@Controller()
export class TradingSignalLogsController {
  constructor(@Inject(PUB_SUB) private readonly pubSub: PubSub) {}
}

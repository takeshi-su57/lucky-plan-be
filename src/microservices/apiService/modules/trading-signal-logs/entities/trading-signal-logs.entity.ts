import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Platform } from '@prisma/client';

import { PerpTradingEventLog } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

@ObjectType()
export class TradingSignalLog {
  @Field(() => Int)
  id: number;

  @Field()
  platform: Platform;

  @Field()
  address: string;

  @Field(() => [PerpTradingEventLog])
  eventLogs: PerpTradingEventLog[];
}

@ObjectType()
export class TradingSignalLogUpdated {
  @Field(() => Int)
  id: number;

  @Field(() => [PerpTradingEventLog])
  eventLogs: PerpTradingEventLog[];
}

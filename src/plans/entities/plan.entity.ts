import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { PlanStatus } from '@prisma/client';

import {
  BotForwardDetails,
  BotForwardShallowDetails,
} from 'src/bots/entities/bot.entity';

registerEnumType(PlanStatus, {
  name: 'PlanStatus',
});

@ObjectType()
export class Plan {
  @Field(() => Int)
  id: number;

  @Field()
  title: string;

  @Field()
  description: string;

  @Field(() => Date, { nullable: true })
  startedAt: Date | null;

  @Field(() => Date, { nullable: true })
  endedAt: Date | null;

  @Field(() => Date)
  scheduledStart: Date;

  @Field(() => Date)
  scheduledEnd: Date;

  @Field(() => PlanStatus)
  status: PlanStatus;
}

@ObjectType()
export class PlanForwardShallowDetails extends Plan {
  @Field(() => [BotForwardShallowDetails])
  bots: BotForwardShallowDetails[];
}

@ObjectType()
export class PlanForwardDetails extends Plan {
  @Field(() => [BotForwardDetails])
  bots: BotForwardDetails[];
}

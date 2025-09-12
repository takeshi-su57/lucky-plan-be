import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  Float,
} from '@nestjs/graphql';
import { PlanStatus } from '@prisma/client';

import { BotForwardDetails } from 'src/microservices/apiService/modules/bots/entities/bot.entity';
import {
  PnlSnapshot,
  TradeHistory,
} from 'src/microservices/apiService/modules/trade-histories/entities/trade-history.entity';
import {
  PerpTradingEventLog,
  PnlSnapshotV2,
} from '../../trade-histories/entities/event-logs.entity';

registerEnumType(PlanStatus, {
  name: 'PlanStatus',
});

@ObjectType()
export class Plan {
  @Field(() => Int)
  id: number;

  @Field(() => String)
  userId: string;

  @Field()
  title: string;

  @Field()
  description: string;

  @Field(() => Date, { nullable: true })
  startedAt: Date | null;

  @Field(() => Date, { nullable: true })
  endedAt: Date | null;

  @Field()
  scheduledStart: Date;

  @Field()
  scheduledEnd: Date;

  @Field(() => PlanStatus)
  status: PlanStatus;
}

@ObjectType()
export class PlanForwardDetails extends Plan {
  @Field(() => [BotForwardDetails])
  bots: BotForwardDetails[];
}

@ObjectType()
export class PlanEdge {
  @Field(() => Int) cursor: number;
  @Field(() => PlanForwardDetails) node: PlanForwardDetails;
}

@ObjectType()
export class PlanPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class PlanConnection {
  @Field(() => [PlanEdge])
  edges: PlanEdge[];
  @Field(() => PlanPageInfo) pageInfo: PlanPageInfo;
}

@ObjectType()
export class ExpertPnlSnapshot extends PnlSnapshot {
  @Field(() => Float)
  score: number;

  @Field(() => Float)
  maxSize: number;

  @Field(() => Float)
  ratio: number;

  @Field(() => [TradeHistory])
  histories: TradeHistory[];

  @Field(() => Float)
  avgDuration: number;

  @Field(() => Float)
  avgPnlRatio: number;

  @Field(() => Int)
  openedPositions: number;
}

@ObjectType()
export class ExpertPnlSnapshotV2 extends PnlSnapshotV2 {
  @Field(() => Float)
  score: number;

  @Field(() => Float)
  maxSize: number;

  @Field(() => Float)
  ratio: number;

  @Field(() => [PerpTradingEventLog])
  histories: PerpTradingEventLog[];

  @Field(() => Float)
  avgDuration: number;

  @Field(() => Float)
  avgPnlRatio: number;

  @Field(() => Int)
  openedPositions: number;
}

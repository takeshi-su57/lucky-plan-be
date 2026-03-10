import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  Float,
  OmitType,
} from '@nestjs/graphql';
import { PlanStatus, Platform } from 'generated/prisma/client';

import { BotForwardDetails } from 'src/microservices/apiService/modules/bots/entities/bot.entity';
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
export class OpenPosition {
  @Field(() => Float)
  openPrice: number;

  @Field(() => Boolean)
  long: boolean;

  @Field(() => Float)
  size: number;

  @Field(() => Float)
  leverage: number;

  @Field(() => Int)
  pairIndex: number;
}

@ObjectType()
export class ContractPnlSummary {
  @Field(() => Int)
  contractId: number;

  @Field(() => Int)
  chainId: number;

  @Field(() => Float)
  realizedPnl: number;

  @Field(() => Int)
  realizedCount: number;

  @Field(() => [OpenPosition])
  openPositions: OpenPosition[];
}

@ObjectType()
export class PlanSummary {
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

  @Field(() => Int)
  botCount: number;

  @Field(() => [ContractPnlSummary])
  leaderPnl: ContractPnlSummary[];

  @Field(() => [ContractPnlSummary])
  followerPnl: ContractPnlSummary[];
}

@ObjectType()
export class PlanSummaryEdge {
  @Field(() => Int)
  cursor: number;

  @Field(() => PlanSummary)
  node: PlanSummary;
}

@ObjectType()
export class PlanSummaryConnection {
  @Field(() => [PlanSummaryEdge])
  edges: PlanSummaryEdge[];

  @Field(() => PlanPageInfo)
  pageInfo: PlanPageInfo;
}

@ObjectType()
export class BotGroup {
  @Field(() => String)
  leaderAddress: string;

  @Field(() => Platform)
  platform: Platform;

  @Field(() => Boolean)
  hasDefault: boolean;

  @Field(() => [BotForwardDetails])
  bots: BotForwardDetails[];
}

@ObjectType()
export class BotGroupEdge {
  @Field(() => Int)
  cursor: number;

  @Field(() => BotGroup)
  node: BotGroup;
}

@ObjectType()
export class BotGroupPageInfo {
  @Field(() => Boolean)
  hasNextPage: boolean;

  @Field(() => Int, { nullable: true })
  endCursor: number | null;
}

@ObjectType()
export class BotGroupConnection {
  @Field(() => [BotGroupEdge])
  edges: BotGroupEdge[];

  @Field(() => BotGroupPageInfo)
  pageInfo: BotGroupPageInfo;

  @Field(() => Int)
  totalGroups: number;
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

@ObjectType()
export class ExpertPnlSnapshotV2Node extends OmitType(ExpertPnlSnapshotV2, [
  'histories',
]) {}

@ObjectType()
export class ExpertPnlSnapshotV2Edge {
  @Field(() => Int) cursor: number;
  @Field(() => ExpertPnlSnapshotV2Node) node: ExpertPnlSnapshotV2Node;
}

@ObjectType()
export class ExpertPnlSnapshotV2PageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class ExpertPnlSnapshotV2Connection {
  @Field(() => [ExpertPnlSnapshotV2Edge])
  edges: ExpertPnlSnapshotV2Edge[];
  @Field(() => ExpertPnlSnapshotV2PageInfo)
  pageInfo: ExpertPnlSnapshotV2PageInfo;
}

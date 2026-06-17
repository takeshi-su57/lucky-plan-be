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
  PerpTradeHistory,
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
export class BotGroupPaginatedResponse {
  @Field(() => [BotGroup])
  items: BotGroup[];

  @Field(() => Int)
  totalGroups: number;

  @Field(() => Int)
  totalPages: number;

  @Field(() => Int)
  currentPage: number;
}

@ObjectType()
export class ExpertPnlSnapshotV2 extends PnlSnapshotV2 {
  @Field(() => Float)
  score: number;

  @Field(() => Float)
  maxSize: number;

  @Field(() => Float)
  ratio: number;

  @Field(() => [PerpTradeHistory])
  histories: PerpTradeHistory[];

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
  @Field(() => String) cursor: string;
  @Field(() => ExpertPnlSnapshotV2Node) node: ExpertPnlSnapshotV2Node;
}

@ObjectType()
export class ExpertPnlSnapshotV2PageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => String, { nullable: true }) endCursor: string | null;
}

@ObjectType()
export class ExpertPnlSnapshotV2Connection {
  @Field(() => [ExpertPnlSnapshotV2Edge])
  edges: ExpertPnlSnapshotV2Edge[];
  @Field(() => ExpertPnlSnapshotV2PageInfo)
  pageInfo: ExpertPnlSnapshotV2PageInfo;
}

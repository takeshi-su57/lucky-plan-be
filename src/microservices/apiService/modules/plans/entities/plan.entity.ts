import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  Float,
} from '@nestjs/graphql';
import { PlanMode, PlanStatus, Platform } from 'generated/prisma/client';

import { BotForwardDetails } from 'src/microservices/apiService/modules/bots/entities/bot.entity';

registerEnumType(PlanStatus, {
  name: 'PlanStatus',
});

registerEnumType(PlanMode, {
  name: 'PlanMode',
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

  @Field(() => PlanMode)
  mode: PlanMode;

  @Field(() => Date, { nullable: true })
  simulationCursor: Date | null;
}

@ObjectType()
export class SimulationResumeResult {
  @Field(() => Boolean)
  accepted: boolean;

  @Field(() => String)
  message: string;

  @Field(() => Date, { nullable: true })
  windowStart: Date | null;

  @Field(() => Date, { nullable: true })
  windowEnd: Date | null;

  @Field(() => Int)
  leaderActionCount: number;

  @Field(() => Int)
  virtualActionCount: number;

  @Field(() => Int)
  virtualTaskCount: number;

  @Field(() => Int)
  finalizedTaskCount: number;

  @Field(() => Int)
  stoppedTaskCount: number;

  @Field(() => Int)
  executionIterations: number;

  @Field(() => Plan)
  plan: Plan;
}

@ObjectType()
export class SimulationProgressLog {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  planId: number;

  @Field(() => String)
  userId: string;

  @Field(() => String)
  runId: string;

  @Field(() => String)
  phase: string;

  @Field(() => String)
  status: string;

  @Field(() => String)
  message: string;

  @Field(() => String, { nullable: true })
  details: string | null;

  @Field(() => Float)
  percent: number;

  @Field(() => Int, { nullable: true })
  contractId: number | null;

  @Field(() => String, { nullable: true })
  contractAddress: string | null;

  @Field(() => String, { nullable: true })
  contractPlatform: string | null;

  @Field(() => Int, { nullable: true })
  contractIndex: number | null;

  @Field(() => Int, { nullable: true })
  contractCount: number | null;

  @Field(() => Float, { nullable: true })
  contractPercent: number | null;

  @Field(() => Date, { nullable: true })
  windowStart: Date | null;

  @Field(() => Date, { nullable: true })
  windowEnd: Date | null;

  @Field(() => Int)
  leaderActionCount: number;

  @Field(() => Int)
  virtualActionCount: number;

  @Field(() => Int)
  virtualTaskCount: number;

  @Field(() => Int)
  finalizedTaskCount: number;

  @Field(() => Int)
  stoppedTaskCount: number;

  @Field(() => Int)
  executionIterations: number;

  @Field(() => Date)
  createdAt: Date;
}

@ObjectType()
export class SimulationProgressLogEdge {
  @Field(() => Int)
  cursor: number;

  @Field(() => SimulationProgressLog)
  node: SimulationProgressLog;
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
export class SimulationProgressLogConnection {
  @Field(() => [SimulationProgressLogEdge])
  edges: SimulationProgressLogEdge[];

  @Field(() => PlanPageInfo)
  pageInfo: PlanPageInfo;
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

  @Field(() => PlanMode)
  mode: PlanMode;

  @Field(() => Date, { nullable: true })
  simulationCursor: Date | null;

  @Field(() => Int)
  botCount: number;
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

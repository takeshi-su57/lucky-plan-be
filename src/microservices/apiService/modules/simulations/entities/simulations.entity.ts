import {
  ObjectType,
  Field,
  Int,
  Float,
  OmitType,
  registerEnumType,
} from '@nestjs/graphql';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/client';

import { Contract } from '../../contracts/entities/contract.entity';
import { PerpTradeHistory } from '../../trade-histories/entities/event-logs.entity';

registerEnumType(SimulationStatus, {
  name: 'SimulationStatus',
});

@ObjectType()
export class SimulationBot {
  @Field(() => Int)
  id: number;

  @Field(() => String)
  leaderAddress: string;

  @Field(() => Float)
  ratio: number;

  @Field(() => Float)
  maxLeverage: number;

  @Field(() => Int)
  simulationPlanId: number;

  @Field(() => Int)
  leaderContractId: number;

  @Field(() => Date)
  startedAt: Date;

  @Field(() => Date, { nullable: true })
  stoppedAt: Date | null;

  @Field(() => BotMode)
  mode: BotMode;

  @Field(() => Contract)
  leaderContract: Contract;

  @Field(() => Int)
  openedPositions: number;

  @Field(() => Int)
  totalPositions: number;

  @Field(() => Float)
  totalPnl: number;

  @Field(() => Float)
  maxDuration: number;

  @Field(() => Float)
  avgDuration: number;

  @Field(() => Float)
  avgPnl: number;

  @Field(() => Float)
  avgPositivePnl: number;

  @Field(() => Float)
  avgNegativePnl: number;

  @Field(() => Float)
  avgSize: number;

  @Field(() => Float)
  avgCollateral: number;

  @Field(() => Float)
  avgPnlPercentageByCollateral: number;

  @Field(() => Float)
  avgPnlPercentageBySize: number;

  @Field(() => Float)
  avgLeverage: number;
}

@ObjectType()
export class SimulationPlan {
  @Field(() => Int)
  id: number;

  @Field(() => String)
  title: string;

  @Field(() => String)
  description: string;

  @Field(() => Date)
  startAt: Date;

  @Field(() => Date)
  endAt: Date;

  @Field(() => Date)
  cursor: Date;

  @Field(() => Int, { nullable: true })
  simulationId: number | null;

  @Field(() => Int)
  openedPositions: number;

  @Field(() => Int)
  totalPositions: number;

  @Field(() => Float)
  totalLeaderPnl: number;

  @Field(() => Float)
  totalFollowerPnl: number;

  @Field(() => [SimulationBot])
  simulationBots: SimulationBot[];
}

@ObjectType()
export class SimulationTradeHistory {
  @Field(() => PerpTradeHistory)
  leader: PerpTradeHistory;

  @Field(() => PerpTradeHistory)
  follower: PerpTradeHistory;
}

@ObjectType()
export class SimulationTradePosition {
  @Field(() => [SimulationTradeHistory])
  histories: SimulationTradeHistory[];

  @Field(() => Float)
  leaderPnl: number;

  @Field(() => Float)
  followerPnl: number;
}

@ObjectType()
export class SimulationBotDetails extends SimulationBot {
  @Field(() => [SimulationTradePosition])
  positions: SimulationTradePosition[];
}

@ObjectType()
export class SimulationPlanDetails extends OmitType(SimulationPlan, [
  'simulationBots',
]) {
  @Field(() => [SimulationBotDetails])
  simulationBots: SimulationBotDetails[];
}

@ObjectType()
export class SimulationPlanEdge {
  @Field(() => Int) cursor: number;
  @Field(() => SimulationPlan) node: SimulationPlan;
}

@ObjectType()
export class SimulationPlanPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class SimulationPlanConnection {
  @Field(() => [SimulationPlanEdge])
  edges: SimulationPlanEdge[];
  @Field(() => SimulationPlanPageInfo) pageInfo: SimulationPlanPageInfo;
}

@ObjectType()
export class Simulation {
  @Field(() => Int)
  id: number;

  @Field(() => String)
  title: string;

  @Field(() => String)
  description: string;

  @Field(() => Platform)
  platform: Platform;

  @Field(() => Date)
  startAt: Date;

  @Field(() => Date)
  endAt: Date;

  @Field(() => Date, { nullable: true })
  cursor: Date | null;

  @Field(() => SimulationStatus)
  status: SimulationStatus;

  @Field(() => String, { nullable: true })
  progressPhase: string | null;

  @Field(() => String, { nullable: true })
  progressMessage: string | null;

  @Field(() => Float)
  progressPercent: number;

  @Field(() => Int)
  selectedLeaderCount: number;

  @Field(() => Int)
  minTrades: number;

  @Field(() => Float)
  minNegativeR2: number;

  @Field(() => Float)
  standardCollateralUsd: number;

  @Field(() => Float)
  maxLeverage: number;

  @Field(() => Int)
  totalSimulationPlans: number;

  @Field(() => Int)
  completedPlans: number;

  @Field(() => Float)
  totalLeaderPnl: number;

  @Field(() => Float)
  totalFollowerPnl: number;

  @Field(() => Float)
  totalNetPnlUsd: number;

  @Field(() => Float)
  totalCostUsd: number;

  @Field(() => Float)
  maxDrawdownUsd: number;

  @Field(() => Int)
  tradeCount: number;

  @Field(() => Float)
  winRate: number;

  @Field(() => Float)
  profitFactor: number;

  @Field(() => String, { nullable: true })
  error: string | null;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

@ObjectType()
export class SimulationLeaderSelection {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  simulationId: number;

  @Field(() => Int, { nullable: true })
  simulationPlanId: number | null;

  @Field(() => String)
  leaderAddress: string;

  @Field(() => Date)
  date: Date;

  @Field(() => Float)
  score: number;

  @Field(() => Float)
  suggestedRatio: number;

  @Field(() => Float)
  suggestedCollateralUsd: number;

  @Field(() => Float)
  rawTotalPnlUsd: number;

  @Field(() => Float)
  rawSlope: number;

  @Field(() => Float)
  rawR2: number;

  @Field(() => Int)
  rawTradeCount: number;

  @Field(() => Float)
  reverseNetPnlUsd: number;

  @Field(() => Float)
  reverseDrawdownUsd: number;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

@ObjectType()
export class SimulationEdge {
  @Field(() => Int) cursor: number;
  @Field(() => Simulation) node: Simulation;
}

@ObjectType()
export class SimulationPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class SimulationConnection {
  @Field(() => [SimulationEdge])
  edges: SimulationEdge[];
  @Field(() => SimulationPageInfo) pageInfo: SimulationPageInfo;
}

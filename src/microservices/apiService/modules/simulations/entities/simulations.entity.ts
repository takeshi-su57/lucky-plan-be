import { ObjectType, Field, Int, Float, OmitType } from '@nestjs/graphql';
import { BotMode } from 'generated/prisma/client';

import { Contract } from '../../contracts/entities/contract.entity';
import { PerpTradeHistory } from '../../trade-histories/entities/event-logs.entity';

@ObjectType()
export class SimulationBot {
  @Field(() => Int)
  id: number;

  @Field()
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

  @Field()
  title: string;

  @Field()
  description: string;

  @Field(() => Date)
  startAt: Date;

  @Field(() => Date)
  endAt: Date;

  @Field(() => Date)
  cursor: Date;

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

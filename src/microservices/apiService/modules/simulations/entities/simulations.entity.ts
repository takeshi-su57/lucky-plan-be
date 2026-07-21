import {
  ObjectType,
  Field,
  Int,
  Float,
  OmitType,
  registerEnumType,
} from '@nestjs/graphql';
import {
  BotMode,
  Platform,
  SimulationResearchExecutionFlow,
  SimulationStatus,
} from 'generated/prisma/client';

import { PerpTradeHistory } from '../../trade-histories/entities/event-logs.entity';
import {
  SimulationScoreFormular,
  SimulationSizingFormular,
} from '../simulation-formulars';

registerEnumType(SimulationStatus, {
  name: 'SimulationStatus',
});

registerEnumType(BotMode, {
  name: 'BotMode',
});

registerEnumType(SimulationResearchExecutionFlow, {
  name: 'SimulationResearchExecutionFlow',
});

registerEnumType(SimulationScoreFormular, {
  name: 'SimulationScoreFormular',
});

registerEnumType(SimulationSizingFormular, {
  name: 'SimulationSizingFormular',
});

@ObjectType()
export class SimulationIntRange {
  @Field(() => Int)
  min: number;

  @Field(() => Int)
  max: number;

  @Field(() => Int)
  gap: number;
}

@ObjectType()
export class SimulationTradeRange {
  @Field(() => Int)
  min: number;

  @Field(() => Int)
  max: number;
}

@ObjectType()
export class SimulationValueRange {
  @Field(() => Float)
  min: number;

  @Field(() => Float)
  max: number;
}

@ObjectType()
export class SimulationTradeRangeGroup {
  @Field(() => [SimulationTradeRange])
  ranges: SimulationTradeRange[];
}

@ObjectType()
export class SimulationValueRangeGroup {
  @Field(() => [SimulationValueRange])
  ranges: SimulationValueRange[];
}

@ObjectType()
export class LeaderEvaluationMetrics {
  @Field(() => Int)
  tradeCount: number;

  @Field(() => Float)
  slope: number;

  @Field(() => Float)
  r2: number;

  @Field(() => Float)
  copiedPnlUsd: number;

  @Field(() => Float)
  copiedProfitFactor: number;

  @Field(() => Float)
  copiedMaxDrawdownUsd: number;
}

@ObjectType()
export class SimulationBot {
  @Field(() => Int)
  id: number;

  @Field(() => String)
  leaderAddress: string;

  @Field(() => Float)
  ratio: number;

  @Field(() => Float)
  baseRatio: number;

  @Field(() => Float)
  score: number;

  @Field(() => Float)
  minCollateral: number;

  @Field(() => Float)
  maxCollateral: number;

  @Field(() => Float)
  minSize: number;

  @Field(() => Float)
  maxSize: number;

  @Field(() => Float)
  minLeverage: number;

  @Field(() => Float)
  maxLeverage: number;

  @Field(() => [SimulationValueRange])
  followerRiskSize: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  followerRiskCollateral: SimulationValueRange[];

  @Field(() => LeaderEvaluationMetrics)
  evaluationMetrics: LeaderEvaluationMetrics;

  @Field(() => Int)
  simulationPlanId: number;

  @Field(() => Platform)
  leaderPlatform: Platform;

  @Field(() => Date)
  startedAt: Date;

  @Field(() => Date, { nullable: true })
  stoppedAt: Date | null;

  @Field(() => BotMode)
  mode: BotMode;

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
export class SimulationBotCacheState {
  @Field(() => Boolean)
  completed: boolean;

  @Field(() => Boolean)
  rebuilding: boolean;

  @Field(() => Boolean)
  rebuildRequested: boolean;

  @Field(() => String, { nullable: true })
  lastError: string | null;

  @Field(() => Date, { nullable: true })
  lastFetchedAt: Date | null;
}

@ObjectType()
export class SimulationBotDetails extends SimulationBot {
  @Field(() => SimulationBotCacheState, { nullable: true })
  cacheState?: SimulationBotCacheState | null;

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
export class Simulation {
  @Field(() => Int)
  id: number;

  @Field(() => String)
  title: string;

  @Field(() => String)
  description: string;

  @Field(() => Platform)
  platform: Platform;

  @Field(() => Int, { nullable: true })
  researchId: number | null;

  @Field(() => BotMode)
  direction: BotMode;

  @Field(() => Date)
  startAt: Date;

  @Field(() => Date)
  endAt: Date;

  @Field(() => Int)
  days: number;

  @Field(() => Int)
  gapDays: number;

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

  @Field(() => [SimulationTradeRange])
  trade: SimulationTradeRange[];

  @Field(() => [SimulationValueRange])
  r2: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  slope: SimulationValueRange[];

  @Field(() => Float)
  standardCollateralUsd: number;

  @Field(() => [SimulationValueRange])
  collateral: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  size: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  leverage: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  leaderExecutionCollateral: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  leaderExecutionSize: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  leaderExecutionLeverage: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  followerRiskSize: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  followerRiskCollateral: SimulationValueRange[];

  @Field(() => [SimulationValueRange])
  score: SimulationValueRange[];

  @Field(() => SimulationScoreFormular)
  scoreFormular: SimulationScoreFormular;

  @Field(() => SimulationSizingFormular)
  sizingFormular: SimulationSizingFormular;

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
export class SimulationResearch {
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

  @Field(() => Int)
  days: number;

  @Field(() => Int)
  gapDays: number;

  @Field(() => BotMode)
  direction: BotMode;

  @Field(() => SimulationResearchExecutionFlow)
  executionFlow: SimulationResearchExecutionFlow;

  @Field(() => [SimulationTradeRangeGroup])
  trade: SimulationTradeRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  r2: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  slope: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  collateral: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  size: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  leverage: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  leaderExecutionCollateral: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  leaderExecutionSize: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  leaderExecutionLeverage: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  followerRiskSize: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  followerRiskCollateral: SimulationValueRangeGroup[];

  @Field(() => [SimulationValueRangeGroup])
  score: SimulationValueRangeGroup[];

  @Field(() => SimulationScoreFormular)
  scoreFormular: SimulationScoreFormular;

  @Field(() => SimulationSizingFormular)
  sizingFormular: SimulationSizingFormular;

  @Field(() => SimulationStatus)
  status: SimulationStatus;

  @Field(() => Date, { nullable: true })
  cursor: Date | null;

  @Field(() => String, { nullable: true })
  progressPhase: string | null;

  @Field(() => String, { nullable: true })
  progressMessage: string | null;

  @Field(() => Float)
  progressPercent: number;

  @Field(() => Int)
  totalRanges: number;

  @Field(() => Int)
  completedRanges: number;

  @Field(() => Int)
  totalPlans: number;

  @Field(() => Int)
  completedPlans: number;

  @Field(() => Int)
  outstandingPlans: number;

  @Field(() => Int)
  queuedPlans: number;

  @Field(() => Int)
  runningPlans: number;

  @Field(() => Int)
  finalizingPlans: number;

  @Field(() => Date, { nullable: true })
  startedAt: Date | null;

  @Field(() => Date, { nullable: true })
  finishedAt: Date | null;

  @Field(() => String, { nullable: true })
  lastError: string | null;

  @Field(() => Int)
  retryAttempts: number;

  @Field(() => Date, { nullable: true })
  nextRetryAt: Date | null;

  @Field(() => Int)
  totalSimulations: number;

  @Field(() => Int)
  completedSimulations: number;

  @Field(() => Date)
  createdAt: Date;

  @Field(() => Date)
  updatedAt: Date;
}

@ObjectType()
export class SimulationResearchDetails extends SimulationResearch {
  @Field(() => [Simulation])
  simulations: Simulation[];
}

@ObjectType()
export class SimulationResearchEdge {
  @Field(() => Int) cursor: number;
  @Field(() => SimulationResearch) node: SimulationResearch;
}

@ObjectType()
export class SimulationResearchPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class SimulationResearchConnection {
  @Field(() => [SimulationResearchEdge])
  edges: SimulationResearchEdge[];
  @Field(() => SimulationResearchPageInfo) pageInfo: SimulationResearchPageInfo;
}

@ObjectType()
class SimulationEvaluatorWorkerCacheView {
  @Field(() => Int) id: number;
  @Field(() => String) platform: string;
  @Field(() => String) status: string;
  @Field(() => Date, { nullable: true })
  coveredStartAt: Date | null;
  @Field(() => Date, { nullable: true })
  coveredEndAt: Date | null;
  @Field(() => String, { nullable: true }) lastError: string | null;
}

@ObjectType()
class SimulationEvaluatorWorkerPrebuildProgressView {
  @Field(() => String) taskId: string;
  @Field(() => String) message: string;
  @Field(() => String) records: string;
  @Field(() => String) totalRecords: string;
  @Field(() => Float) percent: number;
  @Field(() => String) bytes: string;
}

@ObjectType()
export class SimulationEvaluatorWorkerView {
  @Field(() => String) id: string;
  @Field(() => String) displayName: string;
  @Field(() => String) authorizationStatus: string;
  @Field(() => String) runtimeStatus: string;
  @Field(() => String) desiredState: string;
  @Field(() => Int) desiredCapacity: number;
  @Field(() => Int) activeCapacity: number;
  @Field(() => Date, { nullable: true })
  lastHeartbeatAt: Date | null;
  @Field(() => Date, { nullable: true }) lastTaskAt: Date | null;
  @Field(() => String, { nullable: true }) lastError: string | null;
  @Field(() => SimulationEvaluatorWorkerDiagnosticView, { nullable: true })
  lastDiagnostic?: SimulationEvaluatorWorkerDiagnosticView | null;
  @Field(() => Date, { nullable: true }) lastDiagnosticAt: Date | null;
  @Field(() => [SimulationEvaluatorWorkerCacheView])
  platformCaches: SimulationEvaluatorWorkerCacheView[];
  @Field(() => SimulationEvaluatorWorkerPrebuildProgressView, {
    nullable: true,
  })
  prebuildProgress?: SimulationEvaluatorWorkerPrebuildProgressView;
}

@ObjectType()
class SimulationEvaluatorWorkerDiagnosticLogView {
  @Field(() => Date) at: Date;
  @Field(() => String) level: string;
  @Field(() => String) message: string;
}

@ObjectType()
class SimulationEvaluatorWorkerDiagnosticView {
  @Field(() => Int) pid: number;
  @Field(() => Int) uptimeSeconds: number;
  @Field(() => Int) childCapacity: number;
  @Field(() => Int) childCount: number;
  @Field(() => Int) idleChildCount: number;
  @Field(() => Int) runningTaskCount: number;
  @Field(() => Date, { nullable: true }) lastPollAt: Date | null;
  @Field(() => String, { nullable: true }) lastPollError: string | null;
  @Field(() => [SimulationEvaluatorWorkerDiagnosticLogView])
  recentLogs: SimulationEvaluatorWorkerDiagnosticLogView[];
}

@ObjectType()
export class SimulationEvaluatorWorkerTaskView {
  @Field(() => String) id: string;
  @Field(() => String) kind: string;
  @Field(() => String) status: string;
  @Field(() => String) syncStatus: string;
  @Field(() => String, { nullable: true }) platform: string | null;
  @Field(() => String, { nullable: true }) targetWorkerId: string | null;
  @Field(() => String, { nullable: true }) workerId: string | null;
  @Field(() => Date) rangeStartedAt: Date;
  @Field(() => Date) rangeEndedAt: Date;
  @Field(() => Date, { nullable: true }) claimedAt: Date | null;
  @Field(() => Date, { nullable: true }) leaseExpiresAt: Date | null;
  @Field(() => Date, { nullable: true }) completedAt: Date | null;
  @Field(() => Float) progressPercent: number;
  @Field(() => String) progressMessage: string;
  @Field(() => String) progressRecords: string;
  @Field(() => String) progressTotalRecords: string;
  @Field(() => String) progressBytes: string;
  @Field(() => String, { nullable: true }) lastError: string | null;
  @Field(() => String, { nullable: true }) timingJson: string | null;
  @Field(() => Boolean) canCancel: boolean;
  @Field(() => Date) createdAt: Date;
}

@ObjectType()
export class SimulationEvaluatorWorkerTaskConnection {
  @Field(() => [SimulationEvaluatorWorkerTaskView])
  items: SimulationEvaluatorWorkerTaskView[];
  @Field(() => String, { nullable: true })
  nextCursor: string | null;
}

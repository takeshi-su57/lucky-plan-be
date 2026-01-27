import {
  ObjectType,
  Field,
  Int,
  Float,
  registerEnumType,
  ID,
} from '@nestjs/graphql';
import { BacktestTaskStatus, Prisma } from 'generated/prisma/client';
import { JSONScalar } from 'src/global/global.module';

registerEnumType(BacktestTaskStatus, {
  name: 'BacktestTaskStatus',
});

@ObjectType()
export class BacktestTask {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  symbol: string;

  @Field(() => JSONScalar)
  optimizationParams: Prisma.JsonValue;

  @Field()
  startDate: Date;

  @Field()
  endDate: Date;

  @Field()
  interval: string;

  // Optimization method fields
  @Field({ description: 'Search strategy: grid or optuna' })
  searchStrategy: string;

  @Field(() => [String], { description: 'Metrics to optimize (multi-objective)' })
  optimizationMetrics: string[];

  @Field(() => Int, { nullable: true, description: 'Number of Optuna trials' })
  trials?: number | null;

  @Field(() => BacktestTaskStatus)
  status: BacktestTaskStatus;

  @Field(() => Int)
  totalConfigs: number;

  @Field(() => Int)
  processedConfigs: number;

  @Field(() => String, { nullable: true })
  currentConfig?: string | null;

  // Optuna result fields
  @Field(() => [String], {
    description: 'Config IDs of Pareto-optimal results (optuna only)',
  })
  bestConfigIds: string[];

  @Field(() => String, {
    nullable: true,
    description: 'Path to Optuna SQLite DB',
  })
  optunaStudyPath?: string | null;

  @Field(() => Int, {
    nullable: true,
    description: 'PID of running optimizer process',
  })
  optimizerPid?: number | null;

  @Field()
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  startedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  completedAt?: Date | null;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;

  // Template relations (nullable for backwards compatibility)
  @Field(() => ID, { nullable: true })
  templateSearchId?: string | null;

  @Field(() => ID, { nullable: true })
  templateId?: string | null;
}

@ObjectType()
export class BacktestTaskWithResults extends BacktestTask {
  @Field(() => [BacktestResultSummary])
  results: BacktestResultSummary[];
}

@ObjectType()
export class BacktestResultSummary {
  @Field(() => ID)
  id: string;

  @Field()
  configId: string;

  @Field()
  runDate: string;

  @Field(() => Int)
  totalTrades: number;

  @Field(() => Float)
  winRate: number;

  @Field(() => Float)
  totalPnlUsdt: number;

  @Field(() => Float)
  maxDrawdownPercent: number;

  @Field(() => Float, { nullable: true })
  sharpeRatio?: number;

  @Field(() => Float, { nullable: true })
  profitFactor?: number;
}

@ObjectType()
export class TaskStats {
  @Field(() => Int)
  await: number;

  @Field(() => Int)
  processing: number;

  @Field(() => Int)
  done: number;

  @Field(() => Int)
  failed: number;
}

@ObjectType()
export class OptunaDashboardStatus {
  @Field(() => Boolean)
  running: boolean;

  @Field(() => ID, { nullable: true })
  taskId: string | null;

  @Field(() => String, { nullable: true })
  url: string | null;
}

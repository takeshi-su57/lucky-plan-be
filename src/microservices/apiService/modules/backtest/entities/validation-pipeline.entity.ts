import {
  ObjectType,
  Field,
  Int,
  Float,
  ID,
  registerEnumType,
} from '@nestjs/graphql';
import { JSONScalar } from 'src/global/global.module';
import { Prisma, ValidationPipelineStatus } from 'generated/prisma/client';

import { ValidationCandidate } from './validation-candidate.entity';

registerEnumType(ValidationPipelineStatus, {
  name: 'ValidationPipelineStatus',
  description: 'Status of a validation pipeline',
});

@ObjectType()
export class ValidationPipeline {
  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field(() => ID)
  templateSearchId: string;

  @Field(() => ValidationPipelineStatus)
  status: ValidationPipelineStatus;

  @Field(() => JSONScalar, { description: 'Threshold filter configuration' })
  thresholdConfig: Prisma.JsonValue;

  @Field(() => [String], { description: 'Metrics for Pareto optimization' })
  paretoMetrics: string[];

  @Field(() => Float, { description: 'Train ratio for walk-forward analysis' })
  wfaTrainRatio: number;

  @Field(() => Int, { description: 'Number of walk-forward windows' })
  wfaWindows: number;

  @Field(() => Float, { description: 'Minimum consistency score to pass WFA' })
  wfaMinConsistency: number;

  @Field(() => Int, { description: 'Number of robustness test steps' })
  robustnessSteps: number;

  @Field(() => Float, { description: 'Minimum robustness score to pass' })
  robustnessMinScore: number;

  @Field(() => Int)
  totalCandidates: number;

  @Field(() => Int)
  passedThreshold: number;

  @Field(() => Int)
  paretoOptimal: number;

  @Field(() => Int)
  passedWfa: number;

  @Field(() => Int)
  userSelected: number;

  @Field(() => Int)
  passedRobustness: number;

  @Field(() => Int)
  finalApproved: number;

  @Field()
  createdAt: Date;

  @Field(() => Date, { nullable: true })
  startedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  completedAt?: Date | null;

  @Field(() => String, { nullable: true })
  errorMessage?: string | null;
}

@ObjectType()
export class ValidationPipelineWithCandidates extends ValidationPipeline {
  @Field(() => [ValidationCandidate])
  candidates: ValidationCandidate[];
}

@ObjectType()
export class ValidationPipelineStats {
  @Field(() => Int)
  created: number;

  @Field(() => Int)
  running: number;

  @Field(() => Int)
  awaitingUser: number;

  @Field(() => Int)
  completed: number;

  @Field(() => Int)
  failed: number;

  @Field(() => Int)
  cancelled: number;
}

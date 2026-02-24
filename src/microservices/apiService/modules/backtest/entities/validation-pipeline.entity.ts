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
import { ThresholdStep } from './threshold-step.entity';

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
  backtestTaskId: string;

  @Field(() => ValidationPipelineStatus)
  status: ValidationPipelineStatus;

  @Field(() => Int, { description: 'Current step (1-7)' })
  currentStep: number;

  @Field(() => JSONScalar, { nullable: true, description: 'Pareto config: { metrics: string[] }' })
  paretoConfig?: Prisma.JsonValue | null;

  @Field(() => JSONScalar, { nullable: true, description: 'WFA config: { trainRatio, windows, minConsistency }' })
  wfaConfig?: Prisma.JsonValue | null;

  @Field(() => JSONScalar, { nullable: true, description: 'Robustness config: { steps, minScore }' })
  robustnessConfig?: Prisma.JsonValue | null;

  @Field(() => Int, { description: 'Number of completed WFA windows' })
  wfaCompletedWindows: number;

  @Field(() => Int, { description: 'Number of completed robustness steps' })
  robustnessCompletedSteps: number;

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
  inProgress: number;

  @Field(() => Int)
  awaitingUser: number;

  @Field(() => Int)
  completed: number;

  @Field(() => Int)
  failed: number;

  @Field(() => Int)
  cancelled: number;
}

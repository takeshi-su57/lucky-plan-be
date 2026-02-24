import {
  ObjectType,
  Field,
  Int,
  Float,
  ID,
  registerEnumType,
} from '@nestjs/graphql';
import { JSONScalar } from 'src/global/global.module';
import { Prisma, ValidationCandidateStatus } from 'generated/prisma/client';

import { BacktestResult } from './backtest-result.entity';

registerEnumType(ValidationCandidateStatus, {
  name: 'ValidationCandidateStatus',
  description: 'Status of a validation candidate',
});

@ObjectType()
export class ValidationCandidate {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  pipelineId: string;

  @Field(() => ID)
  resultId: string;

  @Field()
  configId: string;

  @Field(() => ValidationCandidateStatus)
  status: ValidationCandidateStatus;

  @Field(() => Boolean, { nullable: true })
  thresholdPassed?: boolean | null;

  @Field(() => Int, { nullable: true })
  paretoRank?: number | null;

  @Field(() => [String], { nullable: true })
  dominatedBy?: string[] | null;

  @Field(() => Float, { nullable: true })
  wfaConsistency?: number | null;

  @Field(() => Boolean, { nullable: true })
  wfaPassed?: boolean | null;

  @Field(() => JSONScalar, { nullable: true, description: 'Per-window WFA results JSON array' })
  wfaWindowResults?: Prisma.JsonValue | null;

  @Field(() => Date, { nullable: true })
  userSelectedAt?: Date | null;

  @Field(() => String, { nullable: true })
  userNotes?: string | null;

  @Field(() => Float, { nullable: true })
  robustnessScore?: number | null;

  @Field(() => Boolean, { nullable: true })
  robustnessPassed?: boolean | null;

  @Field(() => JSONScalar, { nullable: true, description: 'Per-step robustness results JSON array' })
  robustnessStepResults?: Prisma.JsonValue | null;

  @Field(() => Date, { nullable: true })
  finalApprovedAt?: Date | null;

  @Field(() => String, { nullable: true })
  finalNotes?: string | null;

  @Field()
  createdAt: Date;

  @Field()
  updatedAt: Date;
}

@ObjectType()
export class ValidationCandidateWithResult extends ValidationCandidate {
  @Field(() => BacktestResult)
  result: BacktestResult;
}

@ObjectType({
  description: 'Paginated validation candidates with total count',
})
export class PaginatedValidationCandidatesResult {
  @Field(() => [ValidationCandidateWithResult])
  candidates: ValidationCandidateWithResult[];

  @Field(() => Int)
  totalCount: number;
}

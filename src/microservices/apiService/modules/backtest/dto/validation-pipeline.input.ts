import { InputType, Field, Int, Float, ID } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsNumber,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import {
  ValidationPipelineStatus,
  ValidationCandidateStatus,
} from 'generated/prisma/client';

@InputType()
export class ThresholdConfigInput {
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  minSharpeRatio?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  maxSharpeRatio?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  minWinRate?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minProfitFactor?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  maxDrawdownPercent?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  minTotalTrades?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  minTotalPnlPercent?: number;
}

@InputType()
export class CreateValidationPipelineInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  name: string;

  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  templateSearchId: string;

  @Field(() => ThresholdConfigInput)
  @IsNotEmpty()
  thresholdConfig: ThresholdConfigInput;

  @Field(() => [String], {
    defaultValue: ['sharpeRatio', 'totalPnlPercent', 'maxDrawdownPercent'],
    nullable: true,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  paretoMetrics?: string[];

  @Field(() => Float, { defaultValue: 0.7, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(0.9)
  wfaTrainRatio?: number;

  @Field(() => Int, { defaultValue: 3, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  wfaWindows?: number;

  @Field(() => Float, { defaultValue: 0.6, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  wfaMinConsistency?: number;

  @Field(() => Int, { defaultValue: 10, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(50)
  robustnessSteps?: number;

  @Field(() => Float, { defaultValue: 0.7, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  robustnessMinScore?: number;
}

@InputType()
export class UserSelectionInput {
  @Field(() => [ID])
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  selectedCandidateIds: string[];

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  notes?: string;
}

@InputType()
export class FinalApprovalInput {
  @Field(() => [ID])
  @IsNotEmpty()
  @IsArray()
  @IsString({ each: true })
  approvedCandidateIds: string[];

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  notes?: string;
}

@InputType()
export class ValidationPipelineFilterInput {
  @Field(() => ValidationPipelineStatus, { nullable: true })
  @IsOptional()
  @IsEnum(ValidationPipelineStatus)
  status?: ValidationPipelineStatus;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  templateSearchId?: string;

  @Field(() => Int, { defaultValue: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @Field(() => Int, { defaultValue: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

@InputType()
export class ValidationCandidateFilterInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  pipelineId: string;

  @Field(() => ValidationCandidateStatus, { nullable: true })
  @IsOptional()
  @IsEnum(ValidationCandidateStatus)
  status?: ValidationCandidateStatus;

  @Field(() => Int, { defaultValue: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @Field(() => Int, { defaultValue: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

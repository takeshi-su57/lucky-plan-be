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
export class CreateValidationPipelineInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  name: string;

  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  backtestTaskId: string;
}

@InputType()
export class ApplyThresholdStepInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  pipelineId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  metricName: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  operator: string; // "gte" or "lte"

  @Field(() => Float)
  @IsNumber()
  value: number;
}

@InputType()
export class PreviewThresholdStepInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  pipelineId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  metricName: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  operator: string;

  @Field(() => Float)
  @IsNumber()
  value: number;
}

@InputType()
export class ApplyParetoStepInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  pipelineId: string;

  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  metrics: string[];
}

@InputType()
export class PreviewParetoStepInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  pipelineId: string;

  @Field(() => [String])
  @IsArray()
  @IsString({ each: true })
  metrics: string[];
}

@InputType()
export class StartWfaInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  pipelineId: string;

  @Field(() => Float)
  @IsNumber()
  @Min(0.1)
  @Max(0.9)
  trainRatio: number;

  @Field(() => Int)
  @IsInt()
  @Min(1)
  @Max(10)
  windows: number;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  @Max(1)
  minConsistency: number;
}

@InputType()
export class ConfigureRobustnessInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  pipelineId: string;

  @Field(() => Int)
  @IsInt()
  @Min(2)
  @Max(50)
  steps: number;

  @Field(() => Float)
  @IsNumber()
  @Min(0)
  @Max(1)
  minScore: number;
}

@InputType()
export class RunRobustnessStepInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  pipelineId: string;

  @Field(() => Int)
  @IsInt()
  @Min(0)
  stepIndex: number;
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
  backtestTaskId?: string;

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

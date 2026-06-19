import { InputType, Field, Int, PartialType } from '@nestjs/graphql';
import { PlanMode, PlanStatus } from 'generated/prisma/client';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

@InputType()
export class CreatePlanInput {
  @IsNotEmpty()
  @IsString()
  @Field()
  title: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  description: string;

  @IsNotEmpty()
  @IsDate()
  @Field(() => Date)
  scheduledStart: Date;

  @IsNotEmpty()
  @IsDate()
  @Field(() => Date)
  scheduledEnd: Date;

  @IsEnum(PlanMode)
  @Field(() => PlanMode, { defaultValue: PlanMode.Live })
  mode: PlanMode;

  @IsOptional()
  @IsDate()
  @Field(() => Date, { nullable: true })
  simulationCursor?: Date | null;
}

@InputType()
export class UpdatePlanInput extends PartialType(CreatePlanInput) {
  @Field(() => Int)
  id: number;

  @Field(() => PlanStatus)
  status: PlanStatus;

  @Field(() => Date, { nullable: true })
  startedAt?: Date | null;

  @Field(() => Date, { nullable: true })
  endedAt?: Date | null;
}

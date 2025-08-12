import { InputType, Field, Int, PartialType } from '@nestjs/graphql';
import { PlanStatus } from '@prisma/client';
import { IsDate, IsNotEmpty, IsString } from 'class-validator';

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

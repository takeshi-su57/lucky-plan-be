import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsString, ValidateNested } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';
import { BotMode, Platform } from 'generated/prisma/enums';

@InputType()
export class IntRangeInput {
  @Field(() => Int)
  min: number;

  @Field(() => Int)
  max: number;

  @Field(() => Int)
  gap: number;
}

@InputType()
export class FloatRangeInput {
  @Field(() => Float)
  min: number;

  @Field(() => Float)
  max: number;

  @Field(() => Float)
  gap: number;
}

@InputType()
export class IntMinMaxInput {
  @Field(() => Int)
  min: number;

  @Field(() => Int)
  max: number;
}

@InputType()
export class FloatMinMaxInput {
  @Field(() => Float)
  min: number;

  @Field(() => Float)
  max: number;
}

@InputType()
export class CreateSimulationPlanInput {
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
  startAt: Date;

  @IsNotEmpty()
  @IsDate()
  @Field(() => Date)
  endAt: Date;
}

@InputType()
export class CreateSimulationBotInput {
  @Field(() => Int)
  simulationPlanId: number;

  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  leaderAddress: string;

  @IsNotEmpty()
  @Field(() => Platform)
  leaderPlatform: Platform;

  @IsNotEmpty()
  @Field(() => BotMode)
  mode: BotMode;

  @Field(() => Float)
  ratio: number;

  @Field(() => Float)
  maxLeverage: number;
}

@InputType()
export class UpdateSimulationBotInput {
  @Field(() => Int)
  id: number;

  @Field(() => BotMode, { nullable: true })
  mode?: BotMode | null;

  @Field(() => Float, { nullable: true })
  ratio?: number | null;

  @Field(() => Float, { nullable: true })
  maxLeverage?: number | null;
}

@InputType()
export class CreateSimulationInput {
  @IsNotEmpty()
  @IsString()
  @Field()
  title: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  description: string;

  @Field(() => Platform)
  platform: Platform;

  @IsNotEmpty()
  @IsDate()
  @Field(() => Date)
  startAt: Date;

  @IsNotEmpty()
  @IsDate()
  @Field(() => Date)
  endAt: Date;

  @Field(() => Int, { defaultValue: 10 })
  selectedLeaderCount: number;

  @Field(() => BotMode, { defaultValue: BotMode.Reversed })
  direction: BotMode;

  @Field(() => IntMinMaxInput, {
    defaultValue: { min: 3, max: 1000000 },
  })
  trade: IntMinMaxInput;

  @Field(() => FloatMinMaxInput, {
    defaultValue: { min: 0.5, max: 1 },
  })
  r2: FloatMinMaxInput;

  @Field(() => FloatMinMaxInput, {
    defaultValue: { min: 0, max: 1000000000 },
  })
  slope: FloatMinMaxInput;

  @Field(() => Float, { defaultValue: 100 })
  standardCollateralUsd: number;

  @Field(() => Float, { defaultValue: 50 })
  maxLeverage: number;
}

@InputType()
export class UpdateSimulationInput {
  @Field(() => Int)
  id: number;

  @Field(() => String, { nullable: true })
  title?: string | null;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => Int, { nullable: true })
  selectedLeaderCount?: number | null;

  @Field(() => BotMode, { nullable: true })
  direction?: BotMode | null;

  @Field(() => IntMinMaxInput, { nullable: true })
  trade?: IntMinMaxInput | null;

  @Field(() => FloatMinMaxInput, { nullable: true })
  r2?: FloatMinMaxInput | null;

  @Field(() => FloatMinMaxInput, { nullable: true })
  slope?: FloatMinMaxInput | null;

  @Field(() => Float, { nullable: true })
  standardCollateralUsd?: number | null;

  @Field(() => Float, { nullable: true })
  maxLeverage?: number | null;
}

@InputType()
export class CreateSimulationResearchInput {
  @IsNotEmpty()
  @IsString()
  @Field()
  title: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  description: string;

  @Field(() => Platform)
  platform: Platform;

  @IsNotEmpty()
  @IsDate()
  @Field(() => Date)
  startAt: Date;

  @IsNotEmpty()
  @IsDate()
  @Field(() => Date)
  endAt: Date;

  @Field(() => BotMode)
  direction: BotMode;

  @ValidateNested({ each: true })
  @Type(() => IntMinMaxInput)
  @Field(() => [IntMinMaxInput])
  trade: IntMinMaxInput[];

  @ValidateNested({ each: true })
  @Type(() => FloatMinMaxInput)
  @Field(() => [FloatMinMaxInput])
  r2: FloatMinMaxInput[];

  @ValidateNested({ each: true })
  @Type(() => FloatMinMaxInput)
  @Field(() => [FloatMinMaxInput])
  slope: FloatMinMaxInput[];

  @Field(() => [Float])
  maxLeverage: number[];
}

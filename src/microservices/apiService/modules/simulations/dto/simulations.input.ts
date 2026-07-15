import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';
import { BotMode, Platform } from 'generated/prisma/enums';
import {
  DEFAULT_SCORE_FORMULAR,
  DEFAULT_SIZING_FORMULAR,
  SimulationScoreFormular,
  SimulationSizingFormular,
} from '../simulation-formulars';

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
export class IntRangeGroupInput {
  @ValidateNested({ each: true })
  @Type(() => IntMinMaxInput)
  @Field(() => [IntMinMaxInput])
  ranges: IntMinMaxInput[];
}

@InputType()
export class FloatRangeGroupInput {
  @ValidateNested({ each: true })
  @Type(() => FloatMinMaxInput)
  @Field(() => [FloatMinMaxInput])
  ranges: FloatMinMaxInput[];
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

  @Field(() => Float, { defaultValue: 0 })
  minCollateral: number;

  @Field(() => Float, { defaultValue: 1000000000 })
  maxCollateral: number;

  @Field(() => Float, { defaultValue: 0 })
  minLeverage: number;

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
  minCollateral?: number | null;

  @Field(() => Float, { nullable: true })
  maxCollateral?: number | null;

  @Field(() => Float, { nullable: true })
  minLeverage?: number | null;

  @Field(() => Float, { nullable: true })
  maxLeverage?: number | null;
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

  @Field(() => FloatMinMaxInput, { nullable: true })
  collateral?: FloatMinMaxInput | null;

  @Field(() => FloatMinMaxInput, { nullable: true })
  leverage?: FloatMinMaxInput | null;

  @Field(() => FloatMinMaxInput, { nullable: true })
  score?: FloatMinMaxInput | null;

  @Field(() => SimulationScoreFormular, { nullable: true })
  scoreFormular?: SimulationScoreFormular | null;

  @Field(() => SimulationSizingFormular, { nullable: true })
  sizingFormular?: SimulationSizingFormular | null;
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

  @Field(() => Int, { defaultValue: 1 })
  days: number;

  @Field(() => Int, { defaultValue: 0 })
  gapDays: number;

  @Field(() => BotMode)
  direction: BotMode;

  @ValidateNested({ each: true })
  @Type(() => IntRangeGroupInput)
  @Field(() => [IntRangeGroupInput])
  trade: IntRangeGroupInput[];

  @ValidateNested({ each: true })
  @Type(() => FloatRangeGroupInput)
  @Field(() => [FloatRangeGroupInput])
  r2: FloatRangeGroupInput[];

  @ValidateNested({ each: true })
  @Type(() => FloatRangeGroupInput)
  @Field(() => [FloatRangeGroupInput])
  slope: FloatRangeGroupInput[];

  @ValidateNested({ each: true })
  @Type(() => FloatRangeGroupInput)
  @Field(() => [FloatRangeGroupInput])
  collateral: FloatRangeGroupInput[];

  @ValidateNested({ each: true })
  @Type(() => FloatRangeGroupInput)
  @Field(() => [FloatRangeGroupInput])
  leverage: FloatRangeGroupInput[];

  @ValidateNested({ each: true })
  @Type(() => FloatRangeGroupInput)
  @Field(() => [FloatRangeGroupInput])
  score: FloatRangeGroupInput[];

  @IsEnum(SimulationScoreFormular)
  @Field(() => SimulationScoreFormular, {
    defaultValue: DEFAULT_SCORE_FORMULAR,
  })
  scoreFormular?: SimulationScoreFormular;

  @IsEnum(SimulationSizingFormular)
  @Field(() => SimulationSizingFormular, {
    defaultValue: DEFAULT_SIZING_FORMULAR,
  })
  sizingFormular?: SimulationSizingFormular;
}

@InputType()
export class UpdateSimulationResearchInput {
  @Field(() => Int)
  id: number;

  @IsNotEmpty()
  @IsString()
  @Field()
  title: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  description: string;
}

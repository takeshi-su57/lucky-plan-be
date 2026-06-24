import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { IsDate, IsNotEmpty, IsString } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';
import { BotMode, Platform } from 'generated/prisma/enums';

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
  @Field(() => Int)
  leaderContractId: number;

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

  @Field(() => Int, { defaultValue: 3 })
  minTrades: number;

  @Field(() => Float, { defaultValue: 0.25 })
  minNegativeR2: number;

  @Field(() => Float, { defaultValue: 100 })
  standardCollateralUsd: number;

  @Field(() => Float, { defaultValue: 10 })
  minCollateralUsd: number;

  @Field(() => Float, { defaultValue: 500 })
  maxCollateralUsd: number;

  @Field(() => Float, { defaultValue: 0 })
  minRatio: number;

  @Field(() => Float, { defaultValue: 3 })
  maxRatio: number;

  @Field(() => Float, { defaultValue: 50 })
  maxLeverage: number;

  @Field(() => Float, { defaultValue: 0 })
  openFeeRate: number;

  @Field(() => Float, { defaultValue: 0 })
  closeFeeRate: number;

  @Field(() => Float, { defaultValue: 0 })
  slippageRate: number;
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

  @Field(() => Int, { nullable: true })
  minTrades?: number | null;

  @Field(() => Float, { nullable: true })
  minNegativeR2?: number | null;

  @Field(() => Float, { nullable: true })
  standardCollateralUsd?: number | null;

  @Field(() => Float, { nullable: true })
  minCollateralUsd?: number | null;

  @Field(() => Float, { nullable: true })
  maxCollateralUsd?: number | null;

  @Field(() => Float, { nullable: true })
  minRatio?: number | null;

  @Field(() => Float, { nullable: true })
  maxRatio?: number | null;

  @Field(() => Float, { nullable: true })
  maxLeverage?: number | null;

  @Field(() => Float, { nullable: true })
  openFeeRate?: number | null;

  @Field(() => Float, { nullable: true })
  closeFeeRate?: number | null;

  @Field(() => Float, { nullable: true })
  slippageRate?: number | null;
}

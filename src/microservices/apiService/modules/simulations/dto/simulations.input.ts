import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { IsDate, IsNotEmpty, IsString } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';
import { BotMode } from 'generated/prisma/enums';

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

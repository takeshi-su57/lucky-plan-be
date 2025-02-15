import { InputType, Int, Field } from '@nestjs/graphql';

import { IsDate, IsIn, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';
import { BotStatus } from '@prisma/client';
import { CreateStrategyInput } from 'src/strategy/dto/strategy.input';

@InputType()
export class CreateBotInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  leaderAddress: string;

  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  followerAddress: string;

  @Field(() => Int, { nullable: true })
  planId: number | null;

  @IsNotEmpty()
  @Field(() => Int)
  strategyId: number;

  @IsNotEmpty()
  @Field(() => Int)
  leaderContractId: number;

  @IsNotEmpty()
  @Field(() => Int)
  leaderCollateralBaseline: number;

  @IsNotEmpty()
  @Field(() => Int)
  followerContractId: number;
}

export class BotUpdateInput {
  @IsNotEmpty()
  @IsNumber()
  id: number;

  @IsNumber()
  leaderStartedBlock?: number;

  @IsNumber()
  leaderEndedBlock?: number;

  @IsNumber()
  followerStartedBlock?: number;

  @IsNumber()
  followerEndedBlock?: number;

  @IsDate()
  startedAt?: Date;

  @IsDate()
  endedAt?: Date;

  @IsString()
  @IsIn([BotStatus.Created, BotStatus.Live, BotStatus.Stop, BotStatus.Dead])
  status?: BotStatus;
}

@InputType()
export class CreateBotAndStrategyInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  leaderAddress: string;

  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  followerAddress: string;

  @Field(() => CreateStrategyInput)
  strategy: CreateStrategyInput;

  @Field(() => Int, { nullable: true })
  planId: number | null;

  @IsNotEmpty()
  @Field(() => Int)
  leaderCollateralBaseline: number;

  @IsNotEmpty()
  @Field(() => Int)
  followerContractId: number;

  @IsNotEmpty()
  @Field(() => Int)
  leaderContractId: number;
}

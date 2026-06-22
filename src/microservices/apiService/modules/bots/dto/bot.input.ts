import { InputType, Int, Field } from '@nestjs/graphql';

import { IsDate, IsIn, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';
import { BotStatus, BotMode } from 'generated/prisma/client';
import { CreateStrategyInput } from 'src/microservices/apiService/modules/strategy/dto/strategy.input';

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

  @Field(() => Int)
  planId: number;

  @IsNotEmpty()
  @Field(() => Int)
  strategyId: number;

  @IsNotEmpty()
  @Field(() => Int)
  leaderContractId: number;

  @IsNotEmpty()
  @Field(() => Int)
  followerContractId: number;

  @IsNotEmpty()
  @Field(() => BotMode)
  mode: BotMode;
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
  @Field(() => Int)
  planId: number;

  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  leaderAddress: string;

  @IsNotEmpty()
  @Field(() => Int)
  leaderContractId: number;

  @IsWalletAddress()
  @Field(() => String, { nullable: true })
  followerAddress?: string | null;

  @IsNotEmpty()
  @Field(() => Int)
  followerContractId: number;

  @Field(() => CreateStrategyInput)
  strategy: CreateStrategyInput;

  @IsNotEmpty()
  @Field(() => BotMode)
  mode: BotMode;
}

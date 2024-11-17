import { InputType, Int, Field } from '@nestjs/graphql';

import { IsIn, IsNotEmpty, IsNumber, IsString } from 'class-validator';
import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';
import { BotStatus } from '@prisma/client';

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

  @IsNotEmpty()
  @Field(() => Int)
  strategyId: number;

  @IsNotEmpty()
  @Field(() => Int)
  contractId: number;
}

export class BotUpdateInput {
  @IsNotEmpty()
  @IsNumber()
  id: number;

  @IsNumber()
  startedBlock?: number;

  @IsNumber()
  pausedBlock?: number;

  @IsNumber()
  endedBlock?: number;

  @IsString()
  @IsIn([BotStatus.Created, BotStatus.Live, BotStatus.Finish, BotStatus.Dead])
  status?: BotStatus;
}

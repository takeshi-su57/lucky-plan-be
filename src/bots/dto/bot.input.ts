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

  @IsString()
  @IsIn([BotStatus.Created, BotStatus.Live, BotStatus.Stop, BotStatus.Dead])
  status?: BotStatus;
}

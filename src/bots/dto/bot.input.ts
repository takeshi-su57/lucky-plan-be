import { InputType, Int, Field, PartialType, OmitType } from '@nestjs/graphql';
import { Address } from 'viem';
import { BotStatus } from '@prisma/client';
import { IsIn, IsNotEmpty } from 'class-validator';
import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

@InputType()
export class CreateBotInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  leaderAddress: Address;

  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  followerAddress: Address;

  @IsNotEmpty()
  @Field(() => Int)
  strategyId: number;

  @IsNotEmpty()
  @Field(() => Int)
  contractId: number;

  @Field(() => Int, { nullable: true })
  startedBlock: number;

  @Field(() => Int, { nullable: true })
  pausedBlock: number;

  @Field(() => Int, { nullable: true })
  endedBlock: number;

  @IsNotEmpty()
  @IsIn([BotStatus.Created, BotStatus.Live, BotStatus.Finish, BotStatus.Dead])
  @Field()
  status: BotStatus;
}

@InputType()
export class UpdateBotInput extends PartialType(
  OmitType(CreateBotInput, [
    'leaderAddress',
    'followerAddress',
    'strategyId',
    'contractId',
  ]),
) {}

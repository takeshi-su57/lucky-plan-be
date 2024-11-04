import { InputType, Int, Field } from '@nestjs/graphql';
import { Address } from 'viem';
import { IsNotEmpty } from 'class-validator';
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
}

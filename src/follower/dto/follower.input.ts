import { InputType, Field, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsNumber } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

@InputType()
export class GetFollowerByAddressInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;
}

@InputType()
export class WithdrawAllInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;
}

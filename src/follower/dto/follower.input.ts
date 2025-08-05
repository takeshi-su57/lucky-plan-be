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

@InputType()
export class CloseTradeInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  index: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  pairIndex: number;
}

@InputType()
export class UpdateSlInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  index: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => String)
  newSl: number;
}

@InputType()
export class UpdateTpInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  index: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => String)
  newTp: number;
}

@InputType()
export class WithdrawPositivePnlInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  index: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => String)
  amountCollateral: number;
}

@InputType()
export class CancelOrderAfterTimeoutInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  index: number;
}

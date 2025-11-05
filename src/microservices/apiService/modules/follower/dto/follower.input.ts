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
export class OpenTradeInput {
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
  pairIndex: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  leverage: number;

  @IsNotEmpty()
  @Field(() => Boolean)
  long: boolean;

  @IsNotEmpty()
  @Field(() => String)
  collateralAmount: string;

  @IsNotEmpty()
  @Field(() => String)
  tp: string;

  @IsNotEmpty()
  @Field(() => String)
  sl: string;
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

@InputType()
export class UpdateLeverageInput {
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
  @Field(() => Int)
  newLeverage: number;
}

@InputType()
export class IncreasePositionSizeInput {
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

  @IsNotEmpty()
  @Field(() => String)
  collateralDelta: string;

  @IsNotEmpty()
  @Field(() => Int)
  leverageDelta: number;
}

@InputType()
export class DecreasePositionSizeInput {
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

  @IsNotEmpty()
  @Field(() => String)
  collateralDelta: string;

  @IsNotEmpty()
  @Field(() => Int)
  leverageDelta: number;
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
  @Field(() => String)
  newSl: string;
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
  @Field(() => String)
  newTp: string;
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
  @Field(() => String)
  amountCollateral: string;
}

import { InputType, Int, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

@InputType()
export class CreateTradeHistoryInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field()
  address: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  eventName: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  in: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  out: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  pnl: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  blockNumber: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Date)
  timestamp: Date;
}

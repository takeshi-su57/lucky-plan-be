import { Field, InputType, Int } from '@nestjs/graphql';
import { TradeActionType } from '@prisma/client';
import { IsNotEmpty, IsNumber, IsDate } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

export type CreateTradeHistoryInput = {
  address: string;

  action: TradeActionType;

  contractId: number;

  pair: string;

  price: string;

  collateralPriceUsd: string;

  long: number;

  size: string;

  leverage: number;

  pnl: string;

  collateralIndex: number;

  tradeIndex: number;

  collateralDelta: string | null;

  leverageDelta: number | null;

  marketPrice: string | null;

  tradeId: string | null;

  block: number;

  date: Date;
};

@InputType()
export class GetUserTransactionCountsInput {
  @IsNotEmpty()
  @IsWalletAddress()
  @Field(() => String)
  address: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  contractId: number;

  @IsDate()
  @Field(() => Date, { nullable: true })
  startedAt: Date | null;

  @IsDate()
  @Field(() => Date, { nullable: true })
  endedAt: Date | null;
}

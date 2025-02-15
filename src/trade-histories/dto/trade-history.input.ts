import { Field } from '@nestjs/graphql';
import { InputType } from '@nestjs/graphql';
import { TradeActionType } from '@prisma/client';
import { IsNotEmpty, IsNumber, IsDate } from 'class-validator';

import { IsWalletAddress } from 'src/utils/validation-classes/IsWalletAddress';

export type CreateTradeHistoryInput = {
  address: string;

  action: TradeActionType;

  contractId: number;

  pair: string;

  price: number;

  collateralPriceUsd: number;

  long: number;

  size: number;

  leverage: number;

  pnl: number;

  collateralIndex: number;

  tradeIndex: number;

  collateralDelta: number | null;

  leverageDelta: number | null;

  marketPrice: number | null;

  tradeId: string | null;

  block: number;

  date: Date;
};

@InputType()
export class GetUserTransactionCountsInput {
  @IsNotEmpty()
  @IsWalletAddress()
  address: string;

  @IsNotEmpty()
  @IsNumber()
  contractId: number;

  @IsDate()
  @Field(() => Date, { nullable: true })
  startedAt: Date | null;

  @IsDate()
  @Field(() => Date, { nullable: true })
  endedAt: Date | null;
}

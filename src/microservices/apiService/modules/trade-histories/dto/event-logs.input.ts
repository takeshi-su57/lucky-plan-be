import { Field, Float, InputType, Int } from '@nestjs/graphql';
import { Platform } from 'generated/prisma/client';

export type CreatePerpTradingEventLogInput = {
  contractId: number;

  platform: Platform;

  address: string;

  jsonLog: string;

  usdPnl: number;

  block: number;

  logIndex: number;

  transactionHash: string;

  date: Date;
};

@InputType()
export class ExportFilter {
  @Field(() => Float)
  minR2: number;

  @Field(() => Int)
  window: number;

  @Field(() => Float)
  minScore: number;

  @Field(() => Float)
  n: number;

  @Field(() => Float)
  m: number;

  @Field(() => Int)
  minAvgSize: number;

  @Field(() => Int)
  maxAvgSize: number;

  @Field(() => Int)
  minCount: number;

  @Field(() => Int)
  maxCount: number;

  @Field(() => Float)
  ratio: number;
}

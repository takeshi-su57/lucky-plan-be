import { ObjectType, Field, Int, Float, ID } from '@nestjs/graphql';
import { JSONScalar } from 'src/global/global.module';
import { Prisma } from 'generated/prisma/client';

@ObjectType()
export class BacktestResult {
  @Field(() => ID)
  id: string;

  @Field(() => ID)
  taskId: string;

  @Field()
  configId: string;

  @Field()
  runDate: string;

  @Field(() => JSONScalar)
  strategyConfig: Prisma.JsonValue;

  @Field(() => Int)
  totalTrades: number;

  @Field(() => Int)
  winningTrades: number;

  @Field(() => Int)
  losingTrades: number;

  @Field(() => Float)
  winRate: number;

  @Field(() => Float)
  totalPnlUsdt: number;

  @Field(() => Float)
  totalPnlPercent: number;

  @Field(() => Float)
  maxDrawdownUsdt: number;

  @Field(() => Float)
  maxDrawdownPercent: number;

  @Field(() => Float, { nullable: true })
  sharpeRatio?: number | null;

  @Field(() => Float, { nullable: true })
  profitFactor?: number | null;

  @Field()
  resultFolder: string;

  @Field()
  createdAt: Date;
}

@ObjectType()
export class ResultFolder {
  @Field()
  taskId: string;

  @Field()
  date: string;

  @Field()
  configId: string;

  @Field(() => [String])
  files: string[];
}

@ObjectType()
export class ResultFile {
  @Field()
  name: string;

  @Field()
  content: string;

  @Field()
  contentType: string;

  @Field(() => Int)
  size: number;

  @Field(() => Int)
  originalSize: number;

  @Field()
  isCompressed: boolean;
}

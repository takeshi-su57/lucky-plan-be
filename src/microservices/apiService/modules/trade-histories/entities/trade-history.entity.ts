import { ObjectType, Field, Int, Float } from '@nestjs/graphql';
import { Platform } from 'generated/prisma/client';
import { PnlSnapshotV2, PerpTradeHistory } from './event-logs.entity';

@ObjectType()
export class AccPnlV2 {
  @Field(() => Date)
  date: Date;

  @Field(() => Float)
  pnl: number;

  @Field(() => Float)
  in: number;

  @Field(() => Float)
  out: number;

  @Field(() => Float)
  inOut: number;

  @Field(() => Int)
  taskCount: number;

  @Field(() => Int)
  positionCount: number;
}

@ObjectType()
export class BotCount {
  @Field(() => Date)
  date: Date;

  @Field(() => Int)
  botCount: number;
}

@ObjectType()
export class TotalBotV2 {
  @Field(() => String)
  dateStr: string;

  @Field(() => Platform)
  platform: Platform;

  @Field(() => String)
  address: string;
}

@ObjectType()
export class WholeCompressedHistoriesV2 {
  @Field(() => [AccPnlV2])
  accPnls: AccPnlV2[];

  @Field(() => [BotCount])
  botCounts: BotCount[];

  @Field(() => Float)
  maxInvested: number;

  @Field(() => [String], { nullable: true })
  uniqueTraders: string[] | null;

  @Field(() => [TotalBotV2])
  totalBots: TotalBotV2[];
}

@ObjectType()
export class Regression {
  @Field(() => Float)
  slope: number;

  @Field(() => Float)
  intercept: number;

  @Field(() => Float)
  r: number;

  @Field(() => Float)
  r2: number;

  @Field(() => Float)
  chi2: number;

  @Field(() => Float)
  rmsd: number;
}

@ObjectType()
export class Statistic {
  @Field(() => Float)
  averageIn: number;

  @Field(() => Int)
  countIn: number;
}

@ObjectType()
export class PerpTradeHistoryWithDate extends PerpTradeHistory {
  @Field(() => Date)
  date: Date;
}

@ObjectType()
export class PnlSnapshotDevDetailsV2 extends PnlSnapshotV2 {
  @Field(() => [PerpTradeHistoryWithDate])
  histories: PerpTradeHistoryWithDate[];

  @Field(() => Float)
  score: number;
}

@ObjectType()
export class PnlSnapshotInitializedFlag {
  @Field(() => Int)
  id: number;

  @Field(() => String)
  dateStr: string;

  @Field(() => Boolean)
  isInit: boolean;
}

@ObjectType()
export class TestingReport {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  window: number;

  @Field(() => Float)
  minR2: number;

  @Field(() => Float)
  minScore: number;

  @Field(() => Int)
  n: number;

  @Field(() => Int)
  m: number;

  @Field(() => Int)
  weekWeight: number;

  @Field(() => Int)
  monthWeight: number;

  @Field(() => Int)
  threeMonthWeight: number;

  @Field(() => Int)
  allTimeWeight: number;

  @Field(() => Float)
  investedUSD: number;

  @Field(() => Float)
  totalUSDPnl: number;

  @Field(() => Int)
  totalTasks: number;

  @Field(() => Int)
  totalPositions: number;

  @Field(() => Int)
  totalTraders: number;

  @Field(() => Int)
  totalUniqueTraders: number;

  @Field(() => [Float])
  usdPnls: number[];

  @Field(() => Float)
  calculatedR2: number;

  @Field(() => Float)
  calculatedSlope: number;

  @Field(() => Float)
  maxLoss: number;

  @Field(() => Int)
  lossCount: number;

  @Field(() => Float)
  avgLoss: number;

  @Field(() => Float)
  avgProfit: number;

  @Field(() => Float)
  maxProfit: number;

  @Field(() => Int)
  profitCount: number;

  @Field(() => Float)
  peakAccProfit: number;

  @Field(() => Float)
  bottomAccProfit: number;

  @Field(() => Int)
  minAvgSize: number;

  @Field(() => Int)
  maxAvgSize: number;

  @Field(() => Int)
  minCount: number;

  @Field(() => Int)
  maxCount: number;
}

@ObjectType()
export class TestingReportEdge {
  @Field(() => Int) cursor: number;
  @Field(() => TestingReport) node: TestingReport;
}

@ObjectType()
export class TestingReportPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class TestingReportConnection {
  @Field(() => [TestingReportEdge])
  edges: TestingReportEdge[];
  @Field(() => TestingReportPageInfo) pageInfo: TestingReportPageInfo;
}

@ObjectType()
export class StatisticData {
  @Field(() => Float)
  size: number;

  @Field(() => Float)
  countOfLost: number;

  @Field(() => Float)
  sumOfLost: number;

  @Field(() => Int)
  countOfWin: number;

  @Field(() => Float)
  sumOfWin: number;
}

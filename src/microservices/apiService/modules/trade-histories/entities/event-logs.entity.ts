import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  Float,
} from '@nestjs/graphql';
import { Platform, TradeActionType, Version } from 'generated/prisma/client';

registerEnumType(TradeActionType, {
  name: 'TradeActionType',
});

export enum PerpTradeHistoryOperation {
  OPEN = 'open',
  CLOSE = 'close',
  INCREASE_SIZE = 'increaseSize',
  DECREASE_SIZE = 'decreaseSize',
  INCREASE_LEVERAGE = 'increaseLeverage',
  DECREASE_LEVERAGE = 'decreaseLeverage',
}

registerEnumType(PerpTradeHistoryOperation, {
  name: 'PerpTradeHistoryOperation',
});

registerEnumType(Platform, {
  name: 'Platform',
});

registerEnumType(Version, {
  name: 'Version',
});

@ObjectType()
export class PerpTradingEventLog {
  @Field(() => Int)
  id: number;

  @Field()
  address: string;

  @Field(() => Int)
  contractId: number;

  @Field(() => Platform)
  platform: Platform;

  @Field()
  jsonLog: string;

  @Field(() => Float)
  usdPnl: number;

  @Field(() => Int)
  block: number;

  @Field(() => Int)
  logIndex: number;

  @Field(() => Date)
  date: Date;
}

@ObjectType()
export class PnlSnapshotV2 {
  @Field(() => Platform)
  platform: Platform;

  @Field(() => String)
  address: string;

  @Field(() => String)
  dateStr: string;

  @Field(() => Float)
  accUSDPnl: number;
}

@ObjectType()
export class PurePerpTradeHistory {
  @Field(() => String)
  positionKey: string;

  @Field(() => String)
  address: string;

  @Field(() => String)
  pair: string;

  @Field(() => PerpTradeHistoryOperation)
  operation: PerpTradeHistoryOperation;

  @Field(() => Float)
  usdPnl: number;

  @Field(() => Float)
  sizeInUsd: number;

  @Field(() => Float)
  leverage: number;

  @Field(() => Float)
  collateralInUsd: number;

  @Field(() => Float)
  collateralDeltaUsd: number;

  @Field(() => Float)
  sizeDeltaUsd: number;

  @Field(() => Float)
  leverageDelta: number;

  @Field(() => Boolean)
  isLong: boolean;

  @Field(() => Float)
  price: number;
}

@ObjectType()
export class PerpTradeHistory extends PurePerpTradeHistory {
  @Field(() => Int)
  id: number;

  @Field(() => Date)
  date: Date;

  @Field(() => Int)
  contractId: number;

  @Field(() => Platform)
  platform: Platform;
}

@ObjectType()
export class PerpTradePosition {
  @Field(() => [PerpTradeHistory])
  histories: PerpTradeHistory[];
}

@ObjectType()
export class PerpTradePositionsWithSummary {
  @Field(() => [PerpTradePosition])
  positions: PerpTradePosition[];

  @Field(() => Int)
  openedPositions: number;

  @Field(() => Int)
  totalPositions: number;

  @Field(() => Float)
  totalPnl: number;

  @Field(() => Float)
  maxDuration: number;

  @Field(() => Float)
  avgDuration: number;

  @Field(() => Float)
  avgPnl: number;

  @Field(() => Float)
  avgPositivePnl: number;

  @Field(() => Float)
  avgNegativePnl: number;

  @Field(() => Float)
  avgSize: number;

  @Field(() => Float)
  avgCollateral: number;

  @Field(() => Float)
  avgPnlPercentageBySize: number;

  @Field(() => Float)
  avgPnlPercentageByCollateral: number;

  @Field(() => Float)
  avgLeverage: number;
}

@ObjectType()
export class PnlSnapshotV2Details extends PnlSnapshotV2 {
  @Field(() => PerpTradePositionsWithSummary)
  positionsWithSummary: PerpTradePositionsWithSummary;
}

@ObjectType()
export class PnlSnapshotV2InitializedFlag {
  @Field(() => Int)
  id: number;

  @Field(() => Platform)
  platform: Platform;

  @Field(() => String)
  dateStr: string;

  @Field(() => Boolean)
  isInit: boolean;
}

@ObjectType()
export class PnlSnapshotV2DetailsPaginatedResponse {
  @Field(() => [PnlSnapshotV2Details]) items: PnlSnapshotV2Details[];
  @Field(() => Int) total: number;
  @Field(() => Int) currentPage: number;
  @Field(() => Int) totalPages: number;
}

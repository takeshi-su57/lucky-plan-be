import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  Float,
} from '@nestjs/graphql';
import {
  Platform,
  PnlSnapshotKind,
  TradeActionType,
  Version,
} from '@prisma/client';

registerEnumType(TradeActionType, {
  name: 'TradeActionType',
});

registerEnumType(PnlSnapshotKind, {
  name: 'PnlSnapshotKind',
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
  @Field(() => Int)
  id: number;

  @Field(() => Platform)
  platform: Platform;

  @Field(() => String)
  address: string;

  @Field(() => String)
  dateStr: string;

  @Field(() => PnlSnapshotKind)
  kind: PnlSnapshotKind;

  @Field(() => Float)
  accUSDPnl: number;
}

@ObjectType()
export class PerpTradeHistory {
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
export class PnlSnapshotV2Details extends PnlSnapshotV2 {
  @Field(() => [PerpTradingEventLog])
  perpTradingEventLogs: PerpTradingEventLog[];
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
export class PnlSnapshotV2DetailsEdge {
  @Field(() => Int) cursor: number;
  @Field(() => PnlSnapshotV2Details) node: PnlSnapshotV2Details;
}

@ObjectType()
export class PnlSnapshotV2DetailsPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class PnlSnapshotV2DetailsConnection {
  @Field(() => [PnlSnapshotV2DetailsEdge])
  edges: PnlSnapshotV2DetailsEdge[];
  @Field(() => PnlSnapshotV2DetailsPageInfo)
  pageInfo: PnlSnapshotV2DetailsPageInfo;
}

@ObjectType()
export class PnlSnapshotV2DetailsForPaginationAPIPageInfo {
  @Field(() => Int) total: number;
  @Field(() => Int) page: number;
  @Field(() => Int) totalPages: number;
}

@ObjectType()
export class PnlSnapshotV2DetailsForPagination {
  @Field(() => [PnlSnapshotV2Details])
  data: PnlSnapshotV2Details[];
  @Field(() => PnlSnapshotV2DetailsForPaginationAPIPageInfo)
  pageInfo: PnlSnapshotV2DetailsForPaginationAPIPageInfo;
}

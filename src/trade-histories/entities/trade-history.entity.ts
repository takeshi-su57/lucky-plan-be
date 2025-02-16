import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  Float,
} from '@nestjs/graphql';
import { PnlSnapshotKind, TradeActionType } from '@prisma/client';

registerEnumType(TradeActionType, {
  name: 'TradeActionType',
});

registerEnumType(PnlSnapshotKind, {
  name: 'PnlSnapshotKind',
});

@ObjectType()
export class TradeHistory {
  @Field(() => Int)
  id: number;

  @Field()
  address: string;

  @Field(() => TradeActionType)
  action: TradeActionType;

  @Field(() => Int)
  contractId: number;

  @Field()
  pair: string;

  @Field()
  price: string;

  @Field()
  collateralPriceUsd: string;

  @Field(() => Int)
  long: number;

  @Field()
  size: string;

  @Field(() => Int)
  leverage: number;

  @Field()
  pnl: string;

  @Field(() => Int)
  collateralIndex: number;

  @Field(() => Int)
  tradeIndex: number;

  @Field(() => String, { nullable: true })
  collateralDelta: string | null;

  @Field(() => Int, { nullable: true })
  leverageDelta: number | null;

  @Field(() => String, { nullable: true })
  marketPrice: string | null;

  @Field(() => String, { nullable: true })
  tradeId: string | null;

  @Field(() => Int)
  block: number;

  @Field(() => Date)
  date: Date;
}

@ObjectType()
export class PnlSnapshot {
  @Field(() => Int)
  id: number;

  @Field()
  address: string;

  @Field(() => String)
  dateStr: string;

  @Field(() => PnlSnapshotKind)
  kind: PnlSnapshotKind;

  @Field(() => Float)
  accUSDPnl: number;
}

@ObjectType()
export class PnlSnapshotDetails extends PnlSnapshot {
  @Field(() => [TradeHistory])
  histories: TradeHistory[];
}

@ObjectType()
export class PageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class PnlSnapshotDetailsEdge {
  @Field(() => Int) cursor: number;
  @Field(() => PnlSnapshotDetails) node: PnlSnapshotDetails;
}

@ObjectType()
export class PnlSnapshotDetailsConnection {
  @Field(() => [PnlSnapshotDetailsEdge])
  edges: PnlSnapshotDetailsEdge[];
  @Field(() => PageInfo) pageInfo: PageInfo;
}

@ObjectType()
export class TradeTransactionCount {
  @Field(() => Int)
  daily: number;

  @Field(() => Int)
  weekly: number;

  @Field(() => Int)
  monthly: number;
}

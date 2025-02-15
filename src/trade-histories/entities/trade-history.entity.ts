import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
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

  @Field(() => Int)
  price: number;

  @Field(() => Int)
  collateralPriceUsd: number;

  @Field(() => Int)
  long: number;

  @Field(() => Int)
  size: number;

  @Field(() => Int)
  leverage: number;

  @Field(() => Int)
  pnl: number;

  @Field(() => Int)
  collateralIndex: number;

  @Field(() => Int)
  tradeIndex: number;

  @Field(() => Int, { nullable: true })
  collateralDelta: number | null;

  @Field(() => Int, { nullable: true })
  leverageDelta: number | null;

  @Field(() => Int, { nullable: true })
  marketPrice: number | null;

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

  @Field(() => Int)
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

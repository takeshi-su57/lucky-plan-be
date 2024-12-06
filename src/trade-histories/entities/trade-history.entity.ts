import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { PnlSnapshotKind } from '@prisma/client';

registerEnumType(PnlSnapshotKind, {
  name: 'PnlSnapshotKind',
});

@ObjectType()
export class TradeHistory {
  @Field(() => Int)
  id: number;

  @Field()
  address: string;

  @Field()
  eventName: string;

  @Field(() => Int)
  contractId: number;

  @Field(() => Int)
  in: number;

  @Field(() => Int)
  out: number;

  @Field(() => Int)
  pnl: number;

  @Field(() => Int)
  blockNumber: number;

  @Field(() => Date)
  timestamp: Date;
}

@ObjectType()
export class PnlSnapshot {
  @Field(() => Int)
  id: number;

  @Field()
  address: string;

  @Field(() => Int)
  contractId: number;

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

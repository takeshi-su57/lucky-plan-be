import {
  ObjectType,
  Field,
  Int,
  registerEnumType,
  Float,
} from '@nestjs/graphql';
import { Platform, PnlSnapshotKind, Version } from '@prisma/client';

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

import { ObjectType, Field, Int } from '@nestjs/graphql';
import { MissionForwardDetails } from 'src/microservices/apiService/modules/missions/entities/mission.entity';
import { PnlSnapshotV2 } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

@ObjectType()
export class Follower {
  @Field()
  userId: string;

  @Field()
  address: string;

  @Field()
  publicKey: string;

  @Field(() => Int)
  accountIndex: number;
}

@ObjectType()
export class FollowerTrade {
  @Field()
  address: string;

  @Field(() => Int)
  index: number;

  @Field(() => MissionForwardDetails, { nullable: true })
  mission: MissionForwardDetails | null;

  @Field()
  params: string;
}

@ObjectType()
export class FollowerPendingOrder {
  @Field()
  address: string;

  @Field(() => Int)
  index: number;

  @Field()
  params: string;
}

@ObjectType()
export class CollateralBalance {
  @Field(() => Int)
  collateralIndex: number;

  @Field(() => String, { nullable: true })
  balance: string | null;

  @Field(() => String, { nullable: true })
  allowance: string | null;
}

@ObjectType()
export class FollowerDetail extends Follower {
  @Field(() => String, { nullable: true })
  ethBalance: string | null;

  @Field(() => [CollateralBalance], { nullable: true })
  collateralBalances: CollateralBalance[];

  @Field(() => Int)
  contractId: number;

  @Field(() => [FollowerTrade])
  trades: FollowerTrade[];

  @Field(() => [FollowerPendingOrder])
  pendingOrders: FollowerPendingOrder[];

  @Field(() => [PnlSnapshotV2])
  pnlSnapshots: PnlSnapshotV2[];
}

@ObjectType()
export class ContractExecutionResult {
  @Field()
  address: string;

  @Field(() => Int)
  index: number;

  @Field(() => Int)
  contractId: number;

  @Field(() => Boolean)
  success: boolean;

  @Field(() => String)
  message: string;
}

@ObjectType()
export class FollowerEdge {
  @Field(() => Int) cursor: number;
  @Field(() => FollowerDetail) node: FollowerDetail;
}

@ObjectType()
export class FollowerPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class FollowerConnection {
  @Field(() => [FollowerEdge])
  edges: FollowerEdge[];
  @Field(() => FollowerPageInfo) pageInfo: FollowerPageInfo;
}

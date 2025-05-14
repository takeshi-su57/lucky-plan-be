import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Mission } from 'src/missions/entities/mission.entity';
import { PnlSnapshot } from 'src/trade-histories/entities/trade-history.entity';

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

  @Field(() => Mission, { nullable: true })
  mission: Mission | null;

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
export class FollowerDetail extends Follower {
  @Field(() => String, { nullable: true })
  ethBalance: string | null;

  @Field(() => String, { nullable: true })
  usdcBalance: string | null;

  @Field(() => Int)
  contractId: number;

  @Field(() => [FollowerTrade])
  trades: FollowerTrade[];

  @Field(() => [FollowerPendingOrder])
  pendingOrders: FollowerPendingOrder[];

  @Field(() => [PnlSnapshot])
  pnlSnapshots: PnlSnapshot[];
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

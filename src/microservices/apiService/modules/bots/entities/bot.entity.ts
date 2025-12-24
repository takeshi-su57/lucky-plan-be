import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { BotStatus } from 'generated/prisma/client';

import { Contract } from 'src/microservices/apiService/modules/contracts/entities/contract.entity';
import { Follower } from 'src/microservices/apiService/modules/follower/entities/follower.entity';
import { MissionForwardDetails } from 'src/microservices/apiService/modules/missions/entities/mission.entity';
import { Plan } from 'src/microservices/apiService/modules/plans/entities/plan.entity';
import { Strategy } from 'src/microservices/apiService/modules/strategy/entities/strategy.entity';

registerEnumType(BotStatus, {
  name: 'BotStatus',
});

@ObjectType()
export class Bot {
  @Field(() => Int)
  id: number;

  @Field()
  leaderAddress: string;

  @Field()
  followerAddress: string;

  @Field(() => Int)
  strategyId: number;

  @Field(() => Int)
  planId: number;

  @Field(() => Int)
  leaderContractId: number;

  @Field(() => Int)
  leaderCollateralBaseline: number;

  @Field(() => Int)
  followerContractId: number;

  @Field(() => Int, { nullable: true })
  leaderStartedBlock: number | null;

  @Field(() => Int, { nullable: true })
  leaderEndedBlock: number | null;

  @Field(() => Int, { nullable: true })
  followerStartedBlock: number | null;

  @Field(() => Int, { nullable: true })
  followerEndedBlock: number | null;

  @Field(() => Date, { nullable: true })
  startedAt: Date | null;

  @Field(() => Date, { nullable: true })
  endedAt: Date | null;

  @Field(() => BotStatus)
  status: BotStatus;
}

@ObjectType()
export class BotDetails extends Bot {
  @Field(() => Follower)
  follower: Follower;

  @Field(() => Strategy)
  strategy: Strategy;

  @Field(() => Contract)
  leaderContract: Contract;

  @Field(() => Contract)
  followerContract: Contract;
}

@ObjectType()
export class BotForwardDetails extends BotDetails {
  @Field(() => [MissionForwardDetails])
  missions: MissionForwardDetails[];
}

@ObjectType()
export class BotBackwardDetails extends BotDetails {
  @Field(() => Plan)
  plan: Plan;
}

@ObjectType()
export class BotEdge {
  @Field(() => Int) cursor: number;
  @Field(() => BotForwardDetails) node: BotForwardDetails;
}

@ObjectType()
export class BotPageInfo {
  @Field(() => Boolean) hasNextPage: boolean;
  @Field(() => Int, { nullable: true }) endCursor: number | null;
}

@ObjectType()
export class BotConnection {
  @Field(() => [BotEdge])
  edges: BotEdge[];
  @Field(() => BotPageInfo) pageInfo: BotPageInfo;
}

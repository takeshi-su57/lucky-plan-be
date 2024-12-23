import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { BotStatus } from '@prisma/client';

import { Contract } from 'src/contracts/entities/contract.entity';
import { Follower } from 'src/follower/entities/follower.entity';
import { Mission } from 'src/missions/entities/mission.entity';
import { Strategy } from 'src/strategy/entities/strategy.entity';

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
export class BotWithMissions extends Bot {
  @Field(() => [Mission])
  missions: Mission[];
}

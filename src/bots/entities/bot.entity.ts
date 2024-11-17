import { ObjectType, Field, Int } from '@nestjs/graphql';
import { BotStatus } from '@prisma/client';

import { Contract } from 'src/contracts/entities/contract.entity';
import { Follower } from 'src/follower/entities/follower.entity';
import { User } from 'src/users/entities/user.entity';
import { Strategy } from 'src/strategy/entities/strategy.entity';

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
  contractId: number;

  @Field(() => Int, { nullable: true })
  startedBlock: number | null;

  @Field(() => Int, { nullable: true })
  pausedBlock: number | null;

  @Field(() => Int, { nullable: true })
  endedBlock: number | null;

  @Field()
  status: BotStatus;
}

@ObjectType()
export class BotDetails extends Bot {
  @Field(() => User)
  leader: User;

  @Field(() => Follower)
  follower: Follower;

  @Field(() => Strategy)
  strategy: Strategy;

  @Field(() => Contract)
  contract: Contract;
}

import { ObjectType, Field, Int } from '@nestjs/graphql';
import { BotStatus } from '@prisma/client';
import { Address } from 'viem';

@ObjectType()
export class Bot {
  @Field(() => Int)
  id: number;

  @Field()
  leaderAddress: Address;

  @Field()
  followerAddress: Address;

  @Field(() => Int)
  strategyId: number;

  @Field(() => Int)
  contractId: number;

  @Field(() => Int, { nullable: true })
  startedBlock: number;

  @Field(() => Int, { nullable: true })
  pausedBlock: number;

  @Field(() => Int, { nullable: true })
  endedBlock: number;

  @Field()
  status: BotStatus;
}

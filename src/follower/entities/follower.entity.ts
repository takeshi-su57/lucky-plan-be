import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Address } from 'viem';

@ObjectType()
export class Follower {
  @Field()
  address: Address;

  @Field()
  publicKey: string;

  @Field(() => Int)
  accountIndex: number;
}

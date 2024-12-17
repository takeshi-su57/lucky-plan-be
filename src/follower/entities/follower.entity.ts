import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class Follower {
  @Field()
  address: string;

  @Field()
  publicKey: string;

  @Field(() => Int)
  accountIndex: number;
}

@ObjectType()
export class FollowerDetail extends Follower {
  @Field(() => String, { nullable: true })
  ethBalance: string | null;

  @Field(() => String, { nullable: true })
  usdcBalance: string | null;

  @Field(() => Int)
  contractId: number;
}

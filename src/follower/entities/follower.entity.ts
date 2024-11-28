import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class Follower {
  @Field()
  address: string;

  @Field()
  publicKey: string;

  @Field(() => Int)
  accountIndex: number;

  @Field()
  ethBalance: string;

  @Field()
  usdcBalance: string;
}

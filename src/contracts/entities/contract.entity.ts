import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class Contract {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  chainId: number;

  @Field()
  address: string;

  @Field(() => String, { nullable: true })
  description: string | null;
}

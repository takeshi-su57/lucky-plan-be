import { ObjectType, Field, Int } from '@nestjs/graphql';
import { Address } from 'viem';

@ObjectType()
export class Contract {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  chainId: number;

  @Field()
  address: Address;

  @Field(() => String, { nullable: true })
  description: string | null;
}

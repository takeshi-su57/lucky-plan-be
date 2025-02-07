import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { ContractStatus } from '@prisma/client';

registerEnumType(ContractStatus, {
  name: 'ContractStatus',
});

@ObjectType()
export class Contract {
  @Field(() => Int)
  id: number;

  @Field(() => Int)
  chainId: number;

  @Field()
  address: string;

  @Field(() => String)
  description: string;

  @Field(() => ContractStatus)
  status: ContractStatus;
}

@ObjectType()
export class TradePair {
  @Field(() => Int)
  pairIndex: number;

  @Field()
  from: string;

  @Field()
  to: string;
}

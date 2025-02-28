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

  @Field(() => Boolean)
  isTestnet: boolean;

  @Field(() => String, { nullable: true })
  backendUrl: string | null;

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

@ObjectType()
export class TradeCollateral {
  @Field(() => Int)
  collateralIndex: number;

  @Field()
  collateral: string;

  @Field(() => Boolean)
  isActive: boolean;

  @Field(() => String)
  precision: string;

  @Field(() => String)
  precisionDelta: string;
}

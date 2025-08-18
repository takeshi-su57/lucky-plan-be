import { ObjectType, Field, Int, registerEnumType } from '@nestjs/graphql';
import { ContractStatus, Platform, Version } from '@prisma/client';

registerEnumType(ContractStatus, {
  name: 'ContractStatus',
});

@ObjectType()
export class Contract {
  @Field(() => Int)
  id: number;

  @Field(() => Platform)
  platform: Platform;

  @Field(() => Version)
  version: Version;

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

  @Field(() => Int)
  fromBlock: number;

  @Field(() => Int, { nullable: true })
  toBlock: number | null;

  @Field(() => Int)
  lastBlockNumber: number;

  @Field(() => Int)
  lastLeaderboardBlockNumber: number;

  @Field(() => ContractStatus)
  status: ContractStatus;
}

@ObjectType()
export class TradePair {
  @Field(() => Int)
  contractId: number;

  @Field(() => Int)
  pairIndex: number;

  @Field()
  from: string;

  @Field()
  to: string;

  @Field()
  onePercentDepthAboveUsd: string;

  @Field()
  onePercentDepthBelowUsd: string;
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

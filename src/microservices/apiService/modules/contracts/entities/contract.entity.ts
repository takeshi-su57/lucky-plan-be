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

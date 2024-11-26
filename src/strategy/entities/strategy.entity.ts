import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType()
export class Strategy {
  @Field(() => Int)
  id: number;

  @Field()
  strategyKey: string;

  @Field()
  params: string;

  @Field(() => Int)
  ratio: number;

  @Field()
  lifeTime: string;

  @Field()
  minCollateral: string;

  @Field()
  maxCollateral: string;

  @Field()
  maxGas: string;

  @Field()
  minGas: string;

  @Field(() => Int)
  maxLeverage: number;

  @Field(() => Int)
  minLeverage: number;
}

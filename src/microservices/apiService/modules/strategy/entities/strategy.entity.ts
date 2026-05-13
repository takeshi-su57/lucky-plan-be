import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class Strategy {
  @Field(() => Int)
  id: number;

  @Field(() => Float)
  ratio: number;

  @Field(() => Int)
  lifeTime: number;

  @Field(() => Int)
  minCollateral: number;

  @Field(() => Int)
  maxCollateral: number;

  @Field(() => Int)
  maxLeverage: number;

  @Field(() => Int)
  minLeverage: number;

  @Field(() => Float)
  tpPercentage: number;

  @Field(() => Float)
  slPercentage: number;

  @Field(() => Int)
  maxOpenMissions: number;

  @Field(() => String)
  selectedPairs: string;

  @Field(() => String)
  mode: string;
}

import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class Strategy {
  @Field(() => Int)
  id: number;

  @Field()
  params: string;

  @Field(() => Float)
  ratio: number;

  @Field(() => Int)
  lifeTime: number;

  @Field(() => Int)
  minCollateral: number;

  @Field(() => Int)
  maxCollateral: number;

  @Field(() => Int)
  collateralBaseline: number;

  @Field(() => Int)
  maxLeverage: number;

  @Field(() => Int)
  minLeverage: number;
}

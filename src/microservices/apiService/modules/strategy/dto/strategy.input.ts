import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { IsNotEmpty, IsJSON, IsInt, IsNumber } from 'class-validator';

@InputType()
export class CreateStrategyInput {
  @IsNotEmpty()
  @Field()
  strategyKey: string;

  @IsNotEmpty()
  @IsJSON()
  @Field()
  params: string;

  @IsNotEmpty()
  @Field(() => Float)
  ratio: number;

  @IsNotEmpty()
  @IsInt()
  @Field()
  lifeTime: number;

  @IsNotEmpty()
  @IsInt()
  @Field()
  minCollateral: number;

  @IsNotEmpty()
  @IsInt()
  @Field()
  maxCollateral: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  maxLeverage: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  collateralBaseline: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  minLeverage: number;
}

@InputType()
export class UpdateStrategyInput {
  @IsNotEmpty()
  @IsNumber()
  @Field(() => Float)
  ratio: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  minCollateral: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  maxCollateral: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  maxLeverage: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  minLeverage: number;

  @IsNotEmpty()
  @IsInt()
  @Field()
  lifeTime: number;

  @IsNotEmpty()
  @IsJSON()
  @Field()
  params: string;
}

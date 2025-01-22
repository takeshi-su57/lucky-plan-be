import { InputType, Field, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsJSON, IsInt } from 'class-validator';

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
  @IsInt()
  @Field(() => Int)
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

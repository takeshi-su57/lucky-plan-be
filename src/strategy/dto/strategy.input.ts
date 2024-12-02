import { InputType, Field, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsJSON, IsNumber } from 'class-validator';

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
  @IsNumber()
  @Field(() => Int)
  ratio: number;

  @IsNotEmpty()
  @IsNumber()
  @Field()
  lifeTime: number;

  @IsNotEmpty()
  @IsNumber()
  @Field()
  minCapacity: number;

  @IsNotEmpty()
  @IsNumber()
  @Field()
  maxCapacity: number;

  @IsNotEmpty()
  @IsNumber()
  @Field()
  minCollateral: number;

  @IsNotEmpty()
  @IsNumber()
  @Field()
  maxCollateral: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  maxLeverage: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  minLeverage: number;
}

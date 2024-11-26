import { InputType, Field, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsJSON, IsNumber, IsString } from 'class-validator';

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
  @IsString()
  @Field()
  lifeTime: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  minCollateral: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  maxCollateral: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  maxGas: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  minGas: string;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  maxLeverage: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Int)
  minLeverage: number;
}

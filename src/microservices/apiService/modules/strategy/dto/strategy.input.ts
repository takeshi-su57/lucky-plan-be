import { InputType, Field, Int, Float } from '@nestjs/graphql';
import { IsNotEmpty, IsJSON, IsInt, IsNumber, IsString } from 'class-validator';

@InputType()
export class CreateStrategyInput {
  @IsNotEmpty()
  @Field(() => Float)
  ratio: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  lifeTime: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  minCollateral: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  maxCollateral: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  maxLeverage: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  minLeverage: number;

  @IsNumber()
  @Field(() => Float, { defaultValue: 0 })
  tpPercentage: number;

  @IsNumber()
  @Field(() => Float, { defaultValue: 0 })
  slPercentage: number;

  @IsInt()
  @Field(() => Int, { defaultValue: 0 })
  maxOpenMissions: number;

  @IsJSON()
  @Field(() => String, { defaultValue: '[]' })
  selectedPairs: string;

  @IsString()
  @Field(() => String, { defaultValue: 'default' })
  mode: string;
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
  @Field(() => Int)
  lifeTime: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Float)
  tpPercentage: number;

  @IsNotEmpty()
  @IsNumber()
  @Field(() => Float)
  slPercentage: number;

  @IsNotEmpty()
  @IsInt()
  @Field(() => Int)
  maxOpenMissions: number;

  @IsNotEmpty()
  @IsJSON()
  @Field(() => String)
  selectedPairs: string;

  @IsNotEmpty()
  @IsString()
  @Field(() => String)
  mode: string;
}

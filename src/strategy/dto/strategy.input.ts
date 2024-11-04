import { InputType, Field, PartialType } from '@nestjs/graphql';
import { IsNotEmpty, IsJSON } from 'class-validator';

@InputType()
export class CreateStrategyInput {
  @IsNotEmpty()
  @Field()
  strategyKey: string;

  @IsNotEmpty()
  @IsJSON()
  @Field()
  params: string;
}

@InputType()
export class UpdateStrategyInput extends PartialType(CreateStrategyInput) {}

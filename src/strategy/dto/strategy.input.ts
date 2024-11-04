import { InputType, Int, Field, PartialType, OmitType } from '@nestjs/graphql';
import { IsNotEmpty, IsJSON } from 'class-validator';

@InputType()
export class CreateStrategyInput {
  @IsNotEmpty()
  @Field(() => Int)
  id: number;

  @IsNotEmpty()
  @Field()
  strategyKey: string;

  @IsNotEmpty()
  @IsJSON()
  @Field()
  params: string;
}

@InputType()
export class UpdateStrategyInput extends PartialType(
  OmitType(CreateStrategyInput, ['id']),
) {}

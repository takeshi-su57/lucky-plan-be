import { InputType, Field, PartialType, OmitType } from '@nestjs/graphql';
import { IsNotEmpty } from 'class-validator';

@InputType()
export class CreateStrategyMetadataInput {
  @IsNotEmpty()
  @Field()
  key: string;

  @IsNotEmpty()
  @Field()
  title: string;

  @IsNotEmpty()
  @Field()
  description: string;
}

@InputType()
export class UpdateStrategyMetadataInput extends PartialType(
  OmitType(CreateStrategyMetadataInput, ['key']),
) {}

@InputType()
export class EqualCopyParamsInput {}

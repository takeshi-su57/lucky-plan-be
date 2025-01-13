import { InputType, Field, Int } from '@nestjs/graphql';
import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

@InputType()
export class TagInput {
  @IsNotEmpty()
  @IsString()
  @Field()
  tag: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  description: string;

  @IsNotEmpty()
  @IsString()
  @Field()
  color: string;

  @IsOptional()
  @IsNumber()
  @Field(() => Int, { nullable: true })
  categoryId: number | null;
}

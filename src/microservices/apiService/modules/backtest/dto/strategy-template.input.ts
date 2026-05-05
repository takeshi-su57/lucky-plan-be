import { InputType, Field, ID } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { StrategyCategory } from 'generated/prisma/client';
import { JSONScalar } from 'src/global/global.module';

@InputType()
export class CreateStrategyTemplateInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => StrategyCategory)
  @IsNotEmpty()
  @IsEnum(StrategyCategory)
  category: StrategyCategory;

  @Field(() => JSONScalar, {
    description: 'Factory configuration - same structure as OptimizationParams',
  })
  @IsNotEmpty()
  factoryConfig: object;
}

@InputType()
export class UpdateStrategyTemplateInput {
  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  description?: string;

  @Field(() => StrategyCategory, { nullable: true })
  @IsOptional()
  @IsEnum(StrategyCategory)
  category?: StrategyCategory;

  @Field(() => JSONScalar, { nullable: true })
  @IsOptional()
  factoryConfig?: object;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

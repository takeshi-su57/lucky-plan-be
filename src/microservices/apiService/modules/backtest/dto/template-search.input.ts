import { InputType, Field, Int, ID } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsArray,
  IsInt,
  IsIn,
  Min,
  IsEnum,
} from 'class-validator';
import { TemplateSearchStatus } from 'generated/prisma/client';

@InputType()
export class CreateTemplateSearchInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  name: string;

  @Field(() => ID)
  @IsNotEmpty()
  @IsString()
  templateId: string;

  @Field({ description: 'Symbol to run backtest on' })
  @IsNotEmpty()
  @IsString()
  symbol: string;

  @Field()
  @IsNotEmpty()
  startDate: Date;

  @Field()
  @IsNotEmpty()
  endDate: Date;

  @Field({ defaultValue: '1m', nullable: true })
  @IsOptional()
  @IsString()
  interval?: string;

  @Field(() => [String], { defaultValue: ['sharpeRatio'], nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optimizationMetrics?: string[];

  @Field(() => Int, { defaultValue: 100, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  trials?: number;

  @Field({ defaultValue: 'optuna', nullable: true })
  @IsOptional()
  @IsString()
  @IsIn(['grid', 'optuna'])
  searchStrategy?: string;
}

@InputType()
export class TemplateSearchFilterInput {
  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsString()
  templateId?: string;

  @Field(() => TemplateSearchStatus, { nullable: true })
  @IsOptional()
  @IsEnum(TemplateSearchStatus)
  status?: TemplateSearchStatus;

  @Field(() => Int, { defaultValue: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  limit?: number;

  @Field(() => Int, { defaultValue: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

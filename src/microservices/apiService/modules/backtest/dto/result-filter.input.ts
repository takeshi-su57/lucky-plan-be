import { InputType, Field, Int } from '@nestjs/graphql';
import { IsOptional, IsString, IsNumber, IsIn } from 'class-validator';

@InputType()
export class ResultFilterInput {
  @Field(() => String)
  @IsString()
  taskId: string;

  @Field(() => String, { defaultValue: 'totalPnlUsdt' })
  @IsOptional()
  @IsString()
  @IsIn([
    'totalPnlUsdt',
    'winRate',
    'sharpeRatio',
    'profitFactor',
    'maxDrawdownPercent',
    'totalTrades',
  ])
  sortBy?: string;

  @Field(() => String, { defaultValue: 'desc' })
  @IsOptional()
  @IsString()
  @IsIn(['asc', 'desc'])
  sortOrder?: string;

  @Field(() => Int, { defaultValue: 50 })
  @IsOptional()
  @IsNumber()
  limit?: number;

  @Field(() => Int, { defaultValue: 0 })
  @IsOptional()
  @IsNumber()
  offset?: number;
}

@InputType()
export class TopResultsInput {
  @Field(() => String)
  @IsString()
  taskId: string;

  @Field(() => String, { defaultValue: 'totalPnlUsdt' })
  @IsOptional()
  @IsString()
  @IsIn(['totalPnlUsdt', 'winRate', 'sharpeRatio', 'profitFactor'])
  metric?: string;

  @Field(() => Int, { defaultValue: 10 })
  @IsOptional()
  @IsNumber()
  limit?: number;
}

@InputType()
export class ResultFileInput {
  @Field(() => String)
  @IsString()
  taskId: string;

  @Field(() => String)
  @IsString()
  date: string;

  @Field(() => String)
  @IsString()
  configId: string;

  @Field(() => String)
  @IsString()
  @IsIn([
    'config.json',
    'trade-details.csv',
    'trade-summary.csv',
    'pnl-chart.png',
  ])
  fileName: string;
}

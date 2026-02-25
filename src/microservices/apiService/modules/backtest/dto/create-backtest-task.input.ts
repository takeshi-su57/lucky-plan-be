import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsIn,
  IsInt,
  IsArray,
  Min,
} from 'class-validator';
import { JSONScalar } from 'src/global/global.module';

/**
 * Dynamic optimization params structure.
 *
 * For GRID search: Each param value should be an array of values to test.
 * Example:
 * ```json
 * {
 *   "signal": {
 *     "type": "emaCrossover",
 *     "params": {
 *       "fastPeriod": [10, 20, 30],
 *       "slowPeriod": [50, 100, 200]
 *     }
 *   },
 *   ...
 * }
 * ```
 *
 * For OPTUNA search: Params can be ranges { min, max } or fixed values.
 * Example:
 * ```json
 * {
 *   "signal": {
 *     "type": "emaCrossover",
 *     "params": {
 *       "fastPeriod": { "min": 5, "max": 50 },
 *       "slowPeriod": { "min": 50, "max": 200 },
 *       "timeframe": 60
 *     }
 *   },
 *   ...
 * }
 * ```
 */
export interface OptimizationComponentConfig {
  type: string;
  params: Record<string, (number | boolean | string)[]>;
}

export interface OptimizationParams {
  signal: OptimizationComponentConfig;
  filters?: OptimizationComponentConfig[];
  risk: OptimizationComponentConfig;
  exits: OptimizationComponentConfig[];
  platform: OptimizationComponentConfig;
  settings: {
    initialCapital: number[]; // Array for testing multiple capital values
  };
}

@InputType()
export class CreateBacktestTaskInput {
  @Field()
  @IsNotEmpty()
  @IsString()
  name: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  symbol: string;

  @Field()
  @IsNotEmpty()
  startDate: Date;

  @Field()
  @IsNotEmpty()
  endDate: Date;

  @Field({ defaultValue: '1m' })
  @IsOptional()
  @IsString()
  interval?: string;

  @Field(() => JSONScalar, {
    description:
      'Dynamic optimization params. Format depends on searchStrategy.',
  })
  @IsNotEmpty()
  optimizationParams: OptimizationParams;

  // ==================== OPTUNA INTEGRATION FIELDS ====================

  @Field({ defaultValue: 'grid', nullable: true })
  @IsOptional()
  @IsString()
  @IsIn(['grid', 'optuna'])
  searchStrategy?: string;

  @Field(() => [String], { defaultValue: ['sharpeRatio'], nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  optimizationMetrics?: string[];

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  trials?: number;
}

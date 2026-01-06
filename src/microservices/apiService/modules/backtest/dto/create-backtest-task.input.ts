import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, IsOptional } from 'class-validator';
import { JSONScalar } from 'src/global/global.module';

/**
 * Dynamic optimization params structure.
 *
 * Instead of fixed param names, this mirrors the StrategyConfig structure
 * but with arrays of values for each param to test.
 *
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
 *   "filters": [
 *     {
 *       "type": "adxTrend",
 *       "params": {
 *         "period": [14],
 *         "threshold": [20, 25, 30]
 *       }
 *     }
 *   ],
 *   "risk": {
 *     "type": "atrBased",
 *     "params": {
 *       "riskPercent": [1, 2],
 *       "stopMultiplier": [2, 2.5, 3]
 *     }
 *   },
 *   "exits": [
 *     {
 *       "type": "trailingStop",
 *       "params": {
 *         "atrMultiplier": [1.5, 2, 2.5]
 *       }
 *     }
 *   ]
 * }
 * ```
 *
 * The cartesian product of all arrays will be generated as configurations to test.
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
  settings?: {
    capitalBase?: number[];
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
      'Dynamic optimization params. Each param value should be an array of values to test.',
  })
  @IsNotEmpty()
  optimizationParams: OptimizationParams;
}

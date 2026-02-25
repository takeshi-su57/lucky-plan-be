import { Candle } from '../../types';
import {
  ExitCondition,
  ExitSignal,
  Position,
  StrategyState,
} from '../../core/interfaces';
import { ComponentMeta } from '../../core/registry';

export interface TakeProfitParams {
  percent: number; // Fixed percentage target
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for Take Profit Exit
 */
export const takeProfitMeta: ComponentMeta = {
  name: 'Take Profit',
  description: 'Fixed percentage take profit',
  params: [
    {
      name: 'percent',
      type: 'number',
      required: true,
      min: 0.5,
      max: 50,
      description: 'Take profit as percentage of entry',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes (for API consistency)',
    },
    {
      name: 'useCurrentCandle',
      type: 'boolean',
      required: true,
      description: 'Whether to use incomplete candles (for API consistency)',
    },
  ],
};

/**
 * Take Profit Exit
 *
 * Exits position when profit reaches a target percentage.
 * Self-contained - calculates target based on entry price and percent param.
 */
export class TakeProfitExit implements ExitCondition {
  readonly name = 'takeProfit';

  private targetPercent: number;

  constructor(params: TakeProfitParams) {
    this.targetPercent = params.percent;
  }

  processCandle(_candle: Candle): void {
    // No candle processing needed for take profit
  }

  shouldExit(
    position: Position,
    candle: Candle,
    _state: StrategyState,
  ): ExitSignal | null {
    // Calculate target price based on percentage
    const targetPrice =
      position.direction === 'LONG'
        ? position.entryPrice * (1 + this.targetPercent / 100)
        : position.entryPrice * (1 - this.targetPercent / 100);

    // Check if target is hit
    if (position.direction === 'LONG') {
      if (candle.high >= targetPrice) {
        return {
          reason: `Take profit hit (target: ${targetPrice.toFixed(2)})`,
          price: targetPrice,
          timestamp: candle.closeTime,
        };
      }
    } else {
      if (candle.low <= targetPrice) {
        return {
          reason: `Take profit hit (target: ${targetPrice.toFixed(2)})`,
          price: targetPrice,
          timestamp: candle.closeTime,
        };
      }
    }

    return null;
  }

  reset(): void {
    // No state to reset
  }
}

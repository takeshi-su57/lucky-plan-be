import { Candle } from '../../types';
import {
  ExitCondition,
  ExitSignal,
  Position,
  StrategyState,
} from '../../core/interfaces';
import { ComponentMeta } from '../../core/registry';

export interface TimeBasedExitParams {
  maxHoldingCandles: number; // Maximum number of candles to hold position
}

/**
 * Component metadata for Time-based Exit
 */
export const timeBasedMeta: ComponentMeta = {
  name: 'Time-based Exit',
  description: 'Exits position after maximum holding period',
  params: [
    {
      name: 'maxHoldingCandles',
      type: 'number',
      required: true,
      min: 1,
      max: 500,
      description: 'Maximum number of candles to hold a position',
    },
  ],
};

/**
 * Time-based Exit
 *
 * Forces position closure after a maximum holding period.
 * Useful for:
 * - Day trading strategies (close before session end)
 * - Avoiding stale positions
 * - Mean reversion strategies with expected quick moves
 *
 * Counts candles since position entry and exits when limit is reached.
 */
export class TimeBasedExit implements ExitCondition {
  readonly name = 'timeBased';

  private maxHoldingCandles: number;
  private candleCount: number = 0;
  private lastEntryTime: number | null = null;

  constructor(params: TimeBasedExitParams) {
    this.maxHoldingCandles = params.maxHoldingCandles;
  }

  processCandle(_candle: Candle): void {
    // Candle counting is done in shouldExit
  }

  shouldExit(
    position: Position,
    candle: Candle,
    _state: StrategyState,
  ): ExitSignal | null {
    // Reset counter if this is a new position
    if (this.lastEntryTime !== position.entryTime) {
      this.lastEntryTime = position.entryTime;
      this.candleCount = 0;
    }

    // Increment candle count
    this.candleCount++;

    // Check if max holding period reached
    if (this.candleCount >= this.maxHoldingCandles) {
      return {
        reason: `Time exit: ${this.candleCount} candles held (max: ${this.maxHoldingCandles})`,
        price: candle.close,
        timestamp: candle.closeTime,
      };
    }

    return null;
  }

  reset(): void {
    this.candleCount = 0;
    this.lastEntryTime = null;
  }
}

import { Candle } from '../../types';
import {
  ExitCondition,
  ExitSignal,
  Position,
  StrategyState,
} from '../../core/interfaces';
import { ATRIndicator } from '../../indicators';
import { ComponentMeta } from '../../core/registry';

export interface StopLossParams {
  percent: number;
  atrMultiplier: number;
  atrPeriod: number;
}

/**
 * Component metadata for Stop Loss Exit
 */
export const stopLossMeta: ComponentMeta = {
  name: 'Stop Loss',
  description: 'Fixed percentage or ATR-based stop loss',
  params: [
    {
      name: 'percent',
      type: 'number',
      required: true,
      min: 0,
      max: 20,
      description:
        'Stop loss as percentage of entry price (0 to use ATR-based only)',
    },
    {
      name: 'atrMultiplier',
      type: 'number',
      required: true,
      min: 0,
      max: 10,
      description:
        'ATR multiplier for stop distance (0 to use percent-based only)',
    },
    {
      name: 'atrPeriod',
      type: 'number',
      required: true,
      min: 7,
      max: 50,
      description: 'ATR calculation period',
    },
  ],
};

/**
 * Stop Loss Exit
 *
 * Exits position when price hits the calculated stop loss.
 * Self-contained - calculates its own stop loss based on params.
 *
 * Two modes:
 * - Percent mode: Stop at X% from entry price
 * - ATR mode: Stop at entry +/- (ATR * multiplier)
 *
 * - For LONG positions: exits when candle.low <= stopPrice
 * - For SHORT positions: exits when candle.high >= stopPrice
 */
export class StopLossExit implements ExitCondition {
  readonly name = 'stopLoss';

  private stopPercent: number | null;
  private atrMultiplier: number | null;
  private atr: ATRIndicator | null;

  constructor(params: StopLossParams) {
    // Use value if > 0, otherwise null (disabled)
    this.stopPercent = params.percent > 0 ? params.percent : null;
    this.atrMultiplier = params.atrMultiplier > 0 ? params.atrMultiplier : null;

    // Only create ATR indicator if ATR-based stop is enabled
    if (this.atrMultiplier !== null) {
      this.atr = new ATRIndicator(params.atrPeriod);
    } else {
      this.atr = null;
    }

    // Validation: at least one stop method must be enabled
    if (this.stopPercent === null && this.atrMultiplier === null) {
      throw new Error(
        'StopLoss requires at least one stop method: percent > 0 or atrMultiplier > 0',
      );
    }
  }

  processCandle(candle: Candle): void {
    if (this.atr) {
      this.atr.processCandle(candle);
    }
  }

  shouldExit(
    position: Position,
    candle: Candle,
    _state: StrategyState,
  ): ExitSignal | null {
    let stopPrice: number;

    if (this.stopPercent !== null) {
      // Fixed percentage stop
      stopPrice =
        position.direction === 'LONG'
          ? position.entryPrice * (1 - this.stopPercent / 100)
          : position.entryPrice * (1 + this.stopPercent / 100);
    } else if (this.atrMultiplier !== null && this.atr) {
      // ATR-based stop
      const atrValue = this.atr.getATR();
      if (atrValue === null) return null;

      const stopDistance = atrValue * this.atrMultiplier;
      stopPrice =
        position.direction === 'LONG'
          ? position.entryPrice - stopDistance
          : position.entryPrice + stopDistance;
    } else {
      return null;
    }

    // Check if stop is hit
    if (position.direction === 'LONG') {
      if (candle.low <= stopPrice) {
        return {
          reason: `Stop loss hit (stop: ${stopPrice.toFixed(2)})`,
          price: stopPrice,
          timestamp: candle.closeTime,
        };
      }
    } else {
      if (candle.high >= stopPrice) {
        return {
          reason: `Stop loss hit (stop: ${stopPrice.toFixed(2)})`,
          price: stopPrice,
          timestamp: candle.closeTime,
        };
      }
    }

    return null;
  }

  reset(): void {
    if (this.atr) {
      this.atr.reset();
    }
  }
}

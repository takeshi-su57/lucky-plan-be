import { Candle } from '../../types';
import {
  ExitCondition,
  ExitSignal,
  Position,
  StrategyState,
} from '../../core/interfaces';
import { ATRIndicator } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface StopLossParams {
  percent: number;
  atrMultiplier: number;
  atrPeriod: number;
  timeframe: number;
  useCurrentCandle: boolean;
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
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes for ATR calculation',
    },
    {
      name: 'useCurrentCandle',
      type: 'boolean',
      required: true,
      description: 'Whether to use incomplete candles for calculation',
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
  private aggregator: CandleAggregator | null;
  private useCurrentCandle: boolean;

  constructor(params: StopLossParams) {
    // Use value if > 0, otherwise null (disabled)
    this.stopPercent = params.percent > 0 ? params.percent : null;
    this.atrMultiplier = params.atrMultiplier > 0 ? params.atrMultiplier : null;
    this.useCurrentCandle = params.useCurrentCandle;
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;

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
      if (this.aggregator) {
        const htfCandle = this.aggregator.processCandle(candle);
        if (htfCandle) {
          this.atr.processCandle(htfCandle);
        } else if (this.useCurrentCandle) {
          const current = this.aggregator.getCurrentCandle();
          if (current) {
            this.atr.processCandle(current);
          }
        }
      } else {
        this.atr.processCandle(candle);
      }
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
    this.aggregator?.reset();
  }
}

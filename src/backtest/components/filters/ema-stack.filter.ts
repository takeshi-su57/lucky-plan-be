import { Candle } from '../../types';
import { Filter, Signal, StrategyState } from '../../core/interfaces';
import { EMAIndicator } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface EMAStackParams {
  fastPeriod: number;
  midPeriod: number;
  slowPeriod: number;
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for EMA Stack filter
 */
export const emaStackMeta: ComponentMeta = {
  name: 'EMA Stack Bias',
  description:
    'Bias filter: Only trade when EMAs are properly aligned (trend quality)',
  params: [
    {
      name: 'fastPeriod',
      type: 'number',
      required: true,
      min: 5,
      max: 50,
      description: 'Fast EMA period',
    },
    {
      name: 'midPeriod',
      type: 'number',
      required: true,
      min: 20,
      max: 100,
      description: 'Mid EMA period',
    },
    {
      name: 'slowPeriod',
      type: 'number',
      required: true,
      min: 50,
      max: 500,
      description: 'Slow EMA period',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes for EMA calculation',
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
 * EMA Stack Bias Filter
 *
 * Only allows trades when EMAs are properly aligned:
 * - LONG signals only when EMA(fast) > EMA(mid) > EMA(slow)
 * - SHORT signals only when EMA(fast) < EMA(mid) < EMA(slow)
 *
 * This is a Class B bias filter - measures trend quality.
 * Avoids weak or unclear trends.
 */
export class EMAStackFilter implements Filter {
  readonly name = 'emaStack';

  private fastEMA: EMAIndicator;
  private midEMA: EMAIndicator;
  private slowEMA: EMAIndicator;
  private aggregator: CandleAggregator | null;
  private useCurrentCandle: boolean;

  constructor(params: EMAStackParams) {
    this.fastEMA = new EMAIndicator(params.fastPeriod);
    this.midEMA = new EMAIndicator(params.midPeriod);
    this.slowEMA = new EMAIndicator(params.slowPeriod);
    this.useCurrentCandle = params.useCurrentCandle;
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle): void {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        this.processEmaCandles(htfCandle);
      } else if (this.useCurrentCandle) {
        const current = this.aggregator.getCurrentCandle();
        if (current) {
          this.processEmaCandles(current);
        }
      }
    } else {
      this.processEmaCandles(candle);
    }
  }

  private processEmaCandles(candle: Candle): void {
    this.fastEMA.processCandle(candle);
    this.midEMA.processCandle(candle);
    this.slowEMA.processCandle(candle);
  }

  shouldAllow(signal: Signal, _candle: Candle, _state: StrategyState): boolean {
    const fast = this.fastEMA.getEMA();
    const mid = this.midEMA.getEMA();
    const slow = this.slowEMA.getEMA();

    // If any EMA is not ready, don't allow signals
    if (fast === null || mid === null || slow === null) {
      return false;
    }

    // LONG only when properly stacked bullish: fast > mid > slow
    if (signal.direction === 'LONG') {
      return fast > mid && mid > slow;
    }

    // SHORT only when properly stacked bearish: fast < mid < slow
    if (signal.direction === 'SHORT') {
      return fast < mid && mid < slow;
    }

    return false;
  }

  reset(): void {
    this.fastEMA.reset();
    this.midEMA.reset();
    this.slowEMA.reset();
    this.aggregator?.reset();
  }

  // Utility getters for debugging/inspection
  getFastEMA(): number | null {
    return this.fastEMA.getEMA();
  }

  getMidEMA(): number | null {
    return this.midEMA.getEMA();
  }

  getSlowEMA(): number | null {
    return this.slowEMA.getEMA();
  }

  isStackedBullish(): boolean {
    const fast = this.fastEMA.getEMA();
    const mid = this.midEMA.getEMA();
    const slow = this.slowEMA.getEMA();

    if (fast === null || mid === null || slow === null) return false;
    return fast > mid && mid > slow;
  }

  isStackedBearish(): boolean {
    const fast = this.fastEMA.getEMA();
    const mid = this.midEMA.getEMA();
    const slow = this.slowEMA.getEMA();

    if (fast === null || mid === null || slow === null) return false;
    return fast < mid && mid < slow;
  }
}

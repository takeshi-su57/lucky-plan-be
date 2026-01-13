import { Candle } from '../../types';
import { Filter, Signal, StrategyState } from '../../core/interfaces';
import { EMAIndicator } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface EMASlopeParams {
  period: number;
  slopePeriod: number;
  minSlope: number;
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for EMA Slope filter
 */
export const emaSlopeMeta: ComponentMeta = {
  name: 'EMA Slope Bias',
  description:
    'Bias filter: Only trade when EMA has sufficient slope (avoids flat markets)',
  params: [
    {
      name: 'period',
      type: 'number',
      required: true,
      min: 10,
      max: 200,
      description: 'EMA period',
    },
    {
      name: 'slopePeriod',
      type: 'number',
      required: true,
      min: 3,
      max: 50,
      description: 'Number of bars to measure slope',
    },
    {
      name: 'minSlope',
      type: 'number',
      required: true,
      min: 0,
      max: 1,
      description: 'Minimum slope threshold (as ratio, e.g., 0.0001)',
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
 * EMA Slope Bias Filter
 *
 * Blocks trades when EMA is flat or against direction:
 * - LONG signals only allowed when EMA slope > minSlope
 * - SHORT signals only allowed when EMA slope < -minSlope
 *
 * This is a Class B bias filter - measures directional strength.
 * Slope matters more than crossover events.
 */
export class EMASlopeFilter implements Filter {
  readonly name = 'emaSlope';

  private ema: EMAIndicator;
  private aggregator: CandleAggregator | null;
  private slopePeriod: number;
  private minSlope: number;
  private useCurrentCandle: boolean;
  private emaHistory: number[] = [];

  constructor(params: EMASlopeParams) {
    this.ema = new EMAIndicator(params.period);
    this.slopePeriod = params.slopePeriod;
    this.minSlope = params.minSlope;
    this.useCurrentCandle = params.useCurrentCandle;
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle): void {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        this.processEmaCandle(htfCandle);
      }
      if (this.useCurrentCandle) {
        const current = this.aggregator.getCurrentCandle();
        if (current) {
          this.processEmaCandle(current);
        }
      }
    } else {
      this.processEmaCandle(candle);
    }
  }

  private processEmaCandle(candle: Candle): void {
    const emaValue = this.ema.processCandle(candle);

    if (emaValue !== null) {
      this.emaHistory.push(emaValue);

      // Keep only required history
      if (this.emaHistory.length > this.slopePeriod + 1) {
        this.emaHistory.shift();
      }
    }
  }

  shouldAllow(signal: Signal, _candle: Candle, _state: StrategyState): boolean {
    // Need enough history to calculate slope
    if (this.emaHistory.length < this.slopePeriod + 1) {
      return false;
    }

    const currentEMA = this.emaHistory[this.emaHistory.length - 1];
    const pastEMA =
      this.emaHistory[this.emaHistory.length - 1 - this.slopePeriod];

    // Calculate slope as ratio (change per bar normalized by price)
    const slope = (currentEMA - pastEMA) / pastEMA;

    // LONG only when slope is positive and strong enough
    if (signal.direction === 'LONG') {
      return slope > this.minSlope;
    }

    // SHORT only when slope is negative and strong enough
    if (signal.direction === 'SHORT') {
      return slope < -this.minSlope;
    }

    return false;
  }

  reset(): void {
    this.ema.reset();
    this.aggregator?.reset();
    this.emaHistory = [];
  }

  // Utility getters for debugging/inspection
  getEMA(): number | null {
    return this.ema.getEMA();
  }

  getSlope(): number | null {
    if (this.emaHistory.length < this.slopePeriod + 1) {
      return null;
    }

    const currentEMA = this.emaHistory[this.emaHistory.length - 1];
    const pastEMA =
      this.emaHistory[this.emaHistory.length - 1 - this.slopePeriod];

    return (currentEMA - pastEMA) / pastEMA;
  }
}

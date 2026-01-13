import { Candle } from '../../types';
import { SignalGenerator, Signal, StrategyState } from '../../core/interfaces';
import { EMAIndicator } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface EMACrossoverParams {
  fastPeriod: number;
  slowPeriod: number;
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for EMA Crossover signal
 */
export const emaCrossoverMeta: ComponentMeta = {
  name: 'EMA Crossover',
  description: 'Generates signals on EMA crossovers (golden/death cross)',
  params: [
    {
      name: 'fastPeriod',
      type: 'number',
      required: true,
      min: 5,
      max: 100,
      description: 'Fast EMA period',
    },
    {
      name: 'slowPeriod',
      type: 'number',
      required: true,
      min: 20,
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
 * EMA Crossover Signal Generator
 *
 * Generates entry signals based on EMA crossovers:
 * - Golden cross (fast crosses above slow): LONG signal
 * - Death cross (fast crosses below slow): SHORT signal
 *
 * Signal only indicates direction - composer handles position management.
 */
export class EMACrossoverSignal implements SignalGenerator {
  readonly name = 'emaCrossover';

  private fastEMA: EMAIndicator;
  private slowEMA: EMAIndicator;
  private aggregator: CandleAggregator | null;
  private useCurrentCandle: boolean;
  private prevFast: number | null = null;
  private prevSlow: number | null = null;

  constructor(params: EMACrossoverParams) {
    this.fastEMA = new EMAIndicator(params.fastPeriod);
    this.slowEMA = new EMAIndicator(params.slowPeriod);
    this.useCurrentCandle = params.useCurrentCandle;
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle, _state: StrategyState): Signal | null {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        const signal = this.checkCrossover(htfCandle, candle);
        if (signal) return signal;
      }
      if (this.useCurrentCandle) {
        const current = this.aggregator.getCurrentCandle();
        if (current) {
          return this.checkCrossover(current, candle);
        }
      }
      return null;
    } else {
      return this.checkCrossover(candle, candle);
    }
  }

  private checkCrossover(htfCandle: Candle, originalCandle: Candle): Signal | null {
    // Store previous values for crossover detection
    this.prevFast = this.fastEMA.getEMA();
    this.prevSlow = this.slowEMA.getEMA();

    // Calculate new EMAs
    const fast = this.fastEMA.processCandle(htfCandle);
    const slow = this.slowEMA.processCandle(htfCandle);

    // Need both EMAs and previous values to detect crossover
    if (
      fast === null ||
      slow === null ||
      this.prevFast === null ||
      this.prevSlow === null
    ) {
      return null;
    }

    // Detect crossovers
    const wasBelow = this.prevFast < this.prevSlow;
    const wasAbove = this.prevFast > this.prevSlow;
    const isAbove = fast > slow;
    const isBelow = fast < slow;

    // Golden cross: Fast EMA crosses above Slow EMA → LONG
    if (wasBelow && isAbove) {
      return {
        direction: 'LONG',
        source: this.name,
        price: originalCandle.close,
        timestamp: originalCandle.closeTime,
      };
    }

    // Death cross: Fast EMA crosses below Slow EMA → SHORT
    if (wasAbove && isBelow) {
      return {
        direction: 'SHORT',
        source: this.name,
        price: originalCandle.close,
        timestamp: originalCandle.closeTime,
      };
    }

    return null;
  }

  reset(): void {
    this.fastEMA.reset();
    this.slowEMA.reset();
    this.aggregator?.reset();
    this.prevFast = null;
    this.prevSlow = null;
  }

  // Utility getters for debugging/inspection
  getFastEMA(): number | null {
    return this.fastEMA.getEMA();
  }

  getSlowEMA(): number | null {
    return this.slowEMA.getEMA();
  }
}

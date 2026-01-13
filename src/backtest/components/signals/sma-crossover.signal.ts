import { Candle } from '../../types';
import { SignalGenerator, Signal, StrategyState } from '../../core/interfaces';
import { SMAIndicator } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface SMACrossoverParams {
  fastPeriod: number;
  slowPeriod: number;
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for SMA Crossover signal
 */
export const smaCrossoverMeta: ComponentMeta = {
  name: 'SMA Crossover',
  description: 'Generates signals on SMA crossovers (golden/death cross)',
  params: [
    {
      name: 'fastPeriod',
      type: 'number',
      required: true,
      min: 5,
      max: 100,
      description: 'Fast SMA period',
    },
    {
      name: 'slowPeriod',
      type: 'number',
      required: true,
      min: 20,
      max: 500,
      description: 'Slow SMA period',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes for SMA calculation',
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
 * SMA Crossover Signal Generator
 *
 * Generates entry signals based on SMA crossovers:
 * - Golden cross (fast crosses above slow): LONG signal
 * - Death cross (fast crosses below slow): SHORT signal
 *
 * SMA is less responsive than EMA but produces fewer false signals.
 * Signal only indicates direction - composer handles position management.
 */
export class SMACrossoverSignal implements SignalGenerator {
  readonly name = 'smaCrossover';

  private fastSMA: SMAIndicator;
  private slowSMA: SMAIndicator;
  private aggregator: CandleAggregator | null;
  private useCurrentCandle: boolean;
  private prevFast: number | null = null;
  private prevSlow: number | null = null;

  constructor(params: SMACrossoverParams) {
    this.fastSMA = new SMAIndicator(params.fastPeriod);
    this.slowSMA = new SMAIndicator(params.slowPeriod);
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
    this.prevFast = this.fastSMA.getSMA();
    this.prevSlow = this.slowSMA.getSMA();

    // Calculate new SMAs
    const fast = this.fastSMA.processCandle(htfCandle);
    const slow = this.slowSMA.processCandle(htfCandle);

    // Need both SMAs and previous values to detect crossover
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

    // Golden cross: Fast SMA crosses above Slow SMA → LONG
    if (wasBelow && isAbove) {
      return {
        direction: 'LONG',
        source: this.name,
        price: originalCandle.close,
        timestamp: originalCandle.closeTime,
      };
    }

    // Death cross: Fast SMA crosses below Slow SMA → SHORT
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
    this.fastSMA.reset();
    this.slowSMA.reset();
    this.aggregator?.reset();
    this.prevFast = null;
    this.prevSlow = null;
  }

  // Utility getters for debugging/inspection
  getFastSMA(): number | null {
    return this.fastSMA.getSMA();
  }

  getSlowSMA(): number | null {
    return this.slowSMA.getSMA();
  }
}

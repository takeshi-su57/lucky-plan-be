import { Candle } from '../../types';
import { SignalGenerator, Signal, StrategyState } from '../../core/interfaces';
import { MACDIndicator, MACDResult } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface MACDCrossoverParams {
  fastPeriod: number;
  slowPeriod: number;
  signalPeriod: number;
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for MACD Crossover signal
 */
export const macdCrossoverMeta: ComponentMeta = {
  name: 'MACD Crossover',
  description:
    'Generates signals when MACD line crosses signal line (momentum shift)',
  params: [
    {
      name: 'fastPeriod',
      type: 'number',
      required: true,
      min: 5,
      max: 50,
      description: 'Fast EMA period for MACD calculation',
    },
    {
      name: 'slowPeriod',
      type: 'number',
      required: true,
      min: 10,
      max: 100,
      description: 'Slow EMA period for MACD calculation',
    },
    {
      name: 'signalPeriod',
      type: 'number',
      required: true,
      min: 3,
      max: 30,
      description: 'Signal line period (EMA of MACD)',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes for MACD calculation',
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
 * MACD Crossover Signal Generator
 *
 * Generates entry signals based on MACD/Signal line crossovers:
 * - MACD crosses above Signal line: LONG signal
 * - MACD crosses below Signal line: SHORT signal
 *
 * MACD is good for identifying momentum shifts and trend changes.
 * Signal only indicates direction - composer handles position management.
 */
export class MACDCrossoverSignal implements SignalGenerator {
  readonly name = 'macdCrossover';

  private macd: MACDIndicator;
  private aggregator: CandleAggregator | null;
  private useCurrentCandle: boolean;
  private prevMACD: MACDResult | null = null;

  constructor(params: MACDCrossoverParams) {
    this.macd = new MACDIndicator(
      params.fastPeriod,
      params.slowPeriod,
      params.signalPeriod,
    );
    this.useCurrentCandle = params.useCurrentCandle;
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle, _state: StrategyState): Signal | null {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        return this.checkCrossover(htfCandle, candle);
      } else if (this.useCurrentCandle) {
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

  private checkCrossover(
    htfCandle: Candle,
    originalCandle: Candle,
  ): Signal | null {
    // Store previous values for crossover detection
    this.prevMACD = this.macd.getMACD();

    // Calculate new MACD
    const current = this.macd.processCandle(htfCandle);

    // Need both current and previous values to detect crossover
    if (current === null || this.prevMACD === null) {
      return null;
    }

    // Detect crossovers
    const wasBelow = this.prevMACD.macd < this.prevMACD.signal;
    const wasAbove = this.prevMACD.macd > this.prevMACD.signal;
    const isAbove = current.macd > current.signal;
    const isBelow = current.macd < current.signal;

    // Bullish crossover: MACD crosses above Signal line → LONG
    if (wasBelow && isAbove) {
      return {
        direction: 'LONG',
        source: this.name,
        price: originalCandle.close,
        timestamp: originalCandle.closeTime,
      };
    }

    // Bearish crossover: MACD crosses below Signal line → SHORT
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
    this.macd.reset();
    this.aggregator?.reset();
    this.prevMACD = null;
  }

  // Utility getter for debugging/inspection
  getMACD(): MACDResult | null {
    return this.macd.getMACD();
  }
}

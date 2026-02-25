import { Candle } from '../../types';
import { SignalGenerator, Signal, StrategyState } from '../../core/interfaces';
import { BollingerIndicator, BollingerResult } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface BollingerBounceParams {
  period: number;
  stdDev: number;
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for Bollinger Bounce signal
 */
export const bollingerBounceMeta: ComponentMeta = {
  name: 'Bollinger Bounce',
  description:
    'Mean reversion signal when price touches or crosses Bollinger Bands',
  params: [
    {
      name: 'period',
      type: 'number',
      required: true,
      min: 10,
      max: 50,
      description: 'SMA period for middle band',
    },
    {
      name: 'stdDev',
      type: 'number',
      required: true,
      min: 1,
      max: 3,
      description: 'Standard deviation multiplier for bands',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes for Bollinger calculation',
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
 * Bollinger Bounce Signal Generator (Mean Reversion)
 *
 * Generates entry signals based on price touching Bollinger Bands:
 * - Price closes below lower band: LONG signal (expecting bounce)
 * - Price closes above upper band: SHORT signal (expecting pullback)
 *
 * Best used in ranging markets where price oscillates between bands.
 * Signal only indicates direction - composer handles position management.
 */
export class BollingerBounceSignal implements SignalGenerator {
  readonly name = 'bollingerBounce';

  private bollinger: BollingerIndicator;
  private aggregator: CandleAggregator | null;
  private useCurrentCandle: boolean;

  constructor(params: BollingerBounceParams) {
    this.bollinger = new BollingerIndicator(params.period, params.stdDev);
    this.useCurrentCandle = params.useCurrentCandle;
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle, _state: StrategyState): Signal | null {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        return this.checkBounce(htfCandle, candle);
      } else if (this.useCurrentCandle) {
        const current = this.aggregator.getCurrentCandle();
        if (current) {
          return this.checkBounce(current, candle);
        }
      }
      return null;
    } else {
      return this.checkBounce(candle, candle);
    }
  }

  private checkBounce(
    htfCandle: Candle,
    originalCandle: Candle,
  ): Signal | null {
    // Calculate new Bollinger Bands
    const current = this.bollinger.processCandle(htfCandle);

    // Need current values
    if (current === null) {
      return null;
    }

    // Price closes below lower band → LONG (mean reversion)
    if (htfCandle.close < current.lower) {
      return {
        direction: 'LONG',
        source: this.name,
        price: originalCandle.close,
        timestamp: originalCandle.closeTime,
      };
    }

    // Price closes above upper band → SHORT (mean reversion)
    if (htfCandle.close > current.upper) {
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
    this.bollinger.reset();
    this.aggregator?.reset();
  }

  // Utility getter for debugging/inspection
  getBollinger(): BollingerResult | null {
    return this.bollinger.getBollinger();
  }
}

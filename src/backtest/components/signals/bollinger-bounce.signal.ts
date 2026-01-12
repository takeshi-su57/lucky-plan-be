import { Candle } from '../../types';
import { SignalGenerator, Signal, StrategyState } from '../../core/interfaces';
import { BollingerIndicator, BollingerResult } from '../../indicators';
import { ComponentMeta } from '../../core/registry';

export interface BollingerBounceParams {
  period: number;
  stdDev: number;
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

  constructor(params: BollingerBounceParams) {
    this.bollinger = new BollingerIndicator(params.period, params.stdDev);
  }

  processCandle(candle: Candle, _state: StrategyState): Signal | null {
    // Calculate new Bollinger Bands
    const current = this.bollinger.processCandle(candle);

    // Need current values
    if (current === null) {
      return null;
    }

    // Price closes below lower band → LONG (mean reversion)
    if (candle.close < current.lower) {
      return {
        direction: 'LONG',
        source: this.name,
        price: candle.close,
        timestamp: candle.closeTime,
      };
    }

    // Price closes above upper band → SHORT (mean reversion)
    if (candle.close > current.upper) {
      return {
        direction: 'SHORT',
        source: this.name,
        price: candle.close,
        timestamp: candle.closeTime,
      };
    }

    return null;
  }

  reset(): void {
    this.bollinger.reset();
  }

  // Utility getter for debugging/inspection
  getBollinger(): BollingerResult | null {
    return this.bollinger.getBollinger();
  }
}

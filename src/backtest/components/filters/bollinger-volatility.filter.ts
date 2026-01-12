import { Candle } from '../../types';
import { Filter, Signal, StrategyState } from '../../core/interfaces';
import { BollingerIndicator } from '../../indicators';
import { ComponentMeta } from '../../core/registry';

export interface BollingerVolatilityParams {
  period: number;
  stdDev: number;
  minBandwidth: number;
  maxBandwidth: number;
}

/**
 * Component metadata for Bollinger Volatility filter
 */
export const bollingerVolatilityMeta: ComponentMeta = {
  name: 'Bollinger Volatility Filter',
  description: 'Filters signals based on Bollinger Band width (volatility)',
  params: [
    {
      name: 'period',
      type: 'number',
      required: true,
      min: 10,
      max: 50,
      description: 'SMA period for Bollinger calculation',
    },
    {
      name: 'stdDev',
      type: 'number',
      required: true,
      min: 1,
      max: 3,
      description: 'Standard deviation multiplier',
    },
    {
      name: 'minBandwidth',
      type: 'number',
      required: true,
      min: 0.01,
      max: 0.1,
      description: 'Minimum bandwidth (allows breakout after squeeze)',
    },
    {
      name: 'maxBandwidth',
      type: 'number',
      required: true,
      min: 0.05,
      max: 0.5,
      description: 'Maximum bandwidth (blocks signals in extreme volatility)',
    },
  ],
};

/**
 * Bollinger Volatility Filter
 *
 * Filters signals based on Bollinger Band width (volatility):
 * - Blocks signals when bandwidth < minBandwidth (too quiet, squeeze)
 * - Blocks signals when bandwidth > maxBandwidth (too volatile)
 *
 * Use cases:
 * - Set high minBandwidth for breakout strategies (want expanding volatility)
 * - Set low maxBandwidth for mean reversion (want stable range)
 */
export class BollingerVolatilityFilter implements Filter {
  readonly name = 'bollingerVolatility';

  private bollinger: BollingerIndicator;
  private minBandwidth: number;
  private maxBandwidth: number;

  constructor(params: BollingerVolatilityParams) {
    this.bollinger = new BollingerIndicator(params.period, params.stdDev);
    this.minBandwidth = params.minBandwidth;
    this.maxBandwidth = params.maxBandwidth;
  }

  processCandle(candle: Candle): void {
    this.bollinger.processCandle(candle);
  }

  shouldAllow(
    _signal: Signal,
    _candle: Candle,
    _state: StrategyState,
  ): boolean {
    const bb = this.bollinger.getBollinger();

    // If Bollinger is not ready, allow signals (conservative)
    if (bb === null) return true;

    // Block if volatility is too low (squeeze, no movement)
    if (bb.bandwidth < this.minBandwidth) {
      return false;
    }

    // Block if volatility is too high (extreme conditions)
    if (bb.bandwidth > this.maxBandwidth) {
      return false;
    }

    return true;
  }

  reset(): void {
    this.bollinger.reset();
  }

  // Utility getter for debugging/inspection
  getBandwidth(): number | null {
    return this.bollinger.getBollinger()?.bandwidth ?? null;
  }
}

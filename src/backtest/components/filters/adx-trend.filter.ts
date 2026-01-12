import { Candle } from '../../types';
import { Filter, Signal, StrategyState } from '../../core/interfaces';
import { ADXIndicator } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface ADXTrendParams {
  period: number;
  threshold: number;
  timeframe: number;
  inverse: boolean;
}

/**
 * Component metadata for ADX Trend filter
 */
export const adxTrendMeta: ComponentMeta = {
  name: 'ADX Trend Filter',
  description: 'Filters signals based on ADX trend strength',
  params: [
    {
      name: 'period',
      type: 'number',
      required: true,
      min: 7,
      max: 50,
      description: 'ADX calculation period',
    },
    {
      name: 'threshold',
      type: 'number',
      required: true,
      min: 10,
      max: 50,
      description: 'Minimum ADX value to allow signal',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description:
        'Timeframe in minutes for ADX calculation (0 to use candle timeframe)',
    },
    {
      name: 'inverse',
      type: 'boolean',
      required: true,
      description: 'Inverse filter for mean reversion strategies',
    },
  ],
};

/**
 * ADX Trend Filter
 *
 * Filters signals based on ADX trend strength:
 * - Normal mode: Only allows signals when ADX >= threshold (trending market)
 * - Inverse mode: Only allows signals when ADX < threshold (ranging market)
 *
 * Can operate on a higher timeframe by aggregating candles.
 */
export class ADXTrendFilter implements Filter {
  readonly name = 'adxTrend';

  private adx: ADXIndicator;
  private aggregator: CandleAggregator | null;
  private threshold: number;
  private inverse: boolean;

  constructor(params: ADXTrendParams) {
    this.adx = new ADXIndicator(params.period);
    this.threshold = params.threshold;
    this.inverse = params.inverse;
    this.aggregator =
      params.timeframe > 0 ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle): void {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        this.adx.processCandle(htfCandle);
      }
    } else {
      this.adx.processCandle(candle);
    }
  }

  shouldAllow(
    _signal: Signal,
    _candle: Candle,
    _state: StrategyState,
  ): boolean {
    const adxValue = this.adx.getADX();

    // If ADX is not ready, don't allow signals
    if (adxValue === null) return false;

    const isTrending = adxValue >= this.threshold;

    // Inverse mode: only allow in ranging markets (for mean reversion strategies)
    // Normal mode: only allow in trending markets (for trend following strategies)
    return this.inverse ? !isTrending : isTrending;
  }

  reset(): void {
    this.adx.reset();
    this.aggregator?.reset();
  }

  // Utility getters for debugging/inspection
  getADX(): number | null {
    return this.adx.getADX();
  }

  getPlusDI(): number | null {
    return this.adx.getPlusDI();
  }

  getMinusDI(): number | null {
    return this.adx.getMinusDI();
  }
}

import { Candle } from '../../types';
import { Filter, Signal, StrategyState } from '../../core/interfaces';
import { EMAIndicator } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface HTFEMABiasParams {
  timeframe: number;
  period: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for HTF EMA Bias filter
 */
export const htfEmaBiasMeta: ComponentMeta = {
  name: 'HTF EMA Bias',
  description:
    'Bias filter: Use higher timeframe EMA for direction permission (strongest bias)',
  params: [
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes for EMA calculation',
    },
    {
      name: 'period',
      type: 'number',
      required: true,
      min: 10,
      max: 200,
      description: 'EMA period on higher timeframe',
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
 * HTF EMA Bias Filter
 *
 * Uses higher timeframe structure for directional permission:
 * - LONG signals only when HTF close > HTF EMA
 * - SHORT signals only when HTF close < HTF EMA
 *
 * This is a Class A bias filter - the strongest and most robust.
 * Uses CandleAggregator to build HTF candles internally.
 *
 * Key principle: 1m noise resolves inside 5m/15m structure.
 */
export class HTFEMABiasFilter implements Filter {
  readonly name = 'htfEmaBias';

  private aggregator: CandleAggregator | null;
  private ema: EMAIndicator;
  private useCurrentCandle: boolean;
  private lastHTFClose: number | null = null;

  constructor(params: HTFEMABiasParams) {
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;
    this.ema = new EMAIndicator(params.period);
    this.useCurrentCandle = params.useCurrentCandle;
  }

  processCandle(candle: Candle): void {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        this.ema.processCandle(htfCandle);
        this.lastHTFClose = htfCandle.close;
      } else if (this.useCurrentCandle) {
        const current = this.aggregator.getCurrentCandle();
        if (current) {
          this.ema.processCandle(current);
          this.lastHTFClose = current.close;
        }
      }
    } else {
      this.ema.processCandle(candle);
      this.lastHTFClose = candle.close;
    }
  }

  shouldAllow(signal: Signal, _candle: Candle, _state: StrategyState): boolean {
    const emaValue = this.ema.getEMA();

    // If EMA or HTF close is not ready, don't allow signals
    if (emaValue === null || this.lastHTFClose === null) {
      return false;
    }

    // LONG only when HTF price > HTF EMA (bullish structure)
    if (signal.direction === 'LONG') {
      return this.lastHTFClose > emaValue;
    }

    // SHORT only when HTF price < HTF EMA (bearish structure)
    if (signal.direction === 'SHORT') {
      return this.lastHTFClose < emaValue;
    }

    return false;
  }

  reset(): void {
    this.aggregator?.reset();
    this.ema.reset();
    this.lastHTFClose = null;
  }

  // Utility getters for debugging/inspection
  getHTFEMA(): number | null {
    return this.ema.getEMA();
  }

  getHTFClose(): number | null {
    return this.lastHTFClose;
  }

  getCurrentHTFCandle(): Candle | null {
    return this.aggregator?.getCurrentCandle() ?? null;
  }

  getBias(): 'LONG' | 'SHORT' | null {
    const emaValue = this.ema.getEMA();
    if (emaValue === null || this.lastHTFClose === null) return null;

    return this.lastHTFClose > emaValue ? 'LONG' : 'SHORT';
  }
}

import { Candle } from '../../types';
import { Filter, Signal, StrategyState } from '../../core/interfaces';
import { EMAIndicator, SMAIndicator } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface MAPositionParams {
  period: number;
  maType: 'EMA' | 'SMA';
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for MA Position filter
 */
export const maPositionMeta: ComponentMeta = {
  name: 'MA Position Bias',
  description:
    'Bias filter: LONG only above MA, SHORT only below MA (structural bias)',
  params: [
    {
      name: 'period',
      type: 'number',
      required: true,
      min: 10,
      max: 200,
      description: 'MA period',
    },
    {
      name: 'maType',
      type: 'string',
      required: true,
      description: 'MA type: EMA or SMA',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes for MA calculation',
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
 * MA Position Bias Filter
 *
 * Simple structural bias based on price position relative to MA:
 * - LONG signals only allowed when price > MA
 * - SHORT signals only allowed when price < MA
 *
 * This is a Class C bias filter - simple but effective.
 * Changes infrequently, provides stable directional permission.
 */
export class MAPositionFilter implements Filter {
  readonly name = 'maPosition';

  private ma: EMAIndicator | SMAIndicator;
  private aggregator: CandleAggregator | null;
  private useCurrentCandle: boolean;

  constructor(params: MAPositionParams) {
    if (params.maType === 'SMA') {
      this.ma = new SMAIndicator(params.period);
    } else {
      this.ma = new EMAIndicator(params.period);
    }
    this.useCurrentCandle = params.useCurrentCandle;
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle): void {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        this.ma.processCandle(htfCandle);
      }
      if (this.useCurrentCandle) {
        const current = this.aggregator.getCurrentCandle();
        if (current) {
          this.ma.processCandle(current);
        }
      }
    } else {
      this.ma.processCandle(candle);
    }
  }

  shouldAllow(signal: Signal, candle: Candle, _state: StrategyState): boolean {
    const maValue =
      this.ma instanceof EMAIndicator ? this.ma.getEMA() : this.ma.getSMA();

    // If MA is not ready, allow signals (let other filters decide)
    if (maValue === null) return true;

    // LONG only above MA
    if (signal.direction === 'LONG') {
      return candle.close > maValue;
    }

    // SHORT only below MA
    if (signal.direction === 'SHORT') {
      return candle.close < maValue;
    }

    return false;
  }

  reset(): void {
    this.ma.reset();
    this.aggregator?.reset();
  }

  // Utility getter for debugging/inspection
  getMA(): number | null {
    return this.ma instanceof EMAIndicator
      ? this.ma.getEMA()
      : this.ma.getSMA();
  }
}

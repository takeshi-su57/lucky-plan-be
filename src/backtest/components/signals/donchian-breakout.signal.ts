import { Candle } from '../../types';
import { SignalGenerator, Signal, StrategyState } from '../../core/interfaces';
import { DonchianIndicator, DonchianResult } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface DonchianBreakoutParams {
  period: number;
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for Donchian Breakout signal
 */
export const donchianBreakoutMeta: ComponentMeta = {
  name: 'Donchian Breakout',
  description:
    'Generates signals on price breakouts above/below Donchian Channel (Turtle Trading)',
  params: [
    {
      name: 'period',
      type: 'number',
      required: true,
      min: 5,
      max: 100,
      description: 'Lookback period for channel',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes for Donchian calculation',
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
 * Donchian Breakout Signal Generator
 *
 * Generates entry signals based on Donchian Channel breakouts:
 * - Price closes above upper band: LONG signal
 * - Price closes below lower band: SHORT signal
 *
 * This is the classic Turtle Trading system approach.
 * Signal only indicates direction - composer handles position management.
 */
export class DonchianBreakoutSignal implements SignalGenerator {
  readonly name = 'donchianBreakout';

  private entryChannel: DonchianIndicator;
  private aggregator: CandleAggregator | null;
  private useCurrentCandle: boolean;
  private prevEntry: DonchianResult | null = null;

  constructor(params: DonchianBreakoutParams) {
    this.entryChannel = new DonchianIndicator(params.period);
    this.useCurrentCandle = params.useCurrentCandle;
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle, _state: StrategyState): Signal | null {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        return this.checkBreakout(htfCandle, candle);
      } else if (this.useCurrentCandle) {
        const current = this.aggregator.getCurrentCandle();
        if (current) {
          return this.checkBreakout(current, candle);
        }
      }
      return null;
    } else {
      return this.checkBreakout(candle, candle);
    }
  }

  private checkBreakout(
    htfCandle: Candle,
    originalCandle: Candle,
  ): Signal | null {
    // Store previous values for breakout detection
    this.prevEntry = this.entryChannel.getDonchian();

    // Update channel (we use previous values for breakout detection)
    this.entryChannel.processCandle(htfCandle);

    // Need previous channel values for breakout detection
    if (this.prevEntry === null) {
      return null;
    }

    // Price breaks above upper band → LONG breakout
    if (htfCandle.close > this.prevEntry.upper) {
      return {
        direction: 'LONG',
        source: this.name,
        price: originalCandle.close,
        timestamp: originalCandle.closeTime,
      };
    }

    // Price breaks below lower band → SHORT breakout
    if (htfCandle.close < this.prevEntry.lower) {
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
    this.entryChannel.reset();
    this.aggregator?.reset();
    this.prevEntry = null;
  }

  // Utility getter for debugging/inspection
  getChannel(): DonchianResult | null {
    return this.entryChannel.getDonchian();
  }
}

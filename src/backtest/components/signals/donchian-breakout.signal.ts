import { Candle } from '../../types';
import { SignalGenerator, Signal, StrategyState } from '../../core/interfaces';
import { DonchianIndicator, DonchianResult } from '../../indicators';
import { ComponentMeta } from '../../core/registry';

export interface DonchianBreakoutParams {
  period: number;
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
  private prevEntry: DonchianResult | null = null;

  constructor(params: DonchianBreakoutParams) {
    this.entryChannel = new DonchianIndicator(params.period);
  }

  processCandle(candle: Candle, _state: StrategyState): Signal | null {
    // Store previous values for breakout detection
    this.prevEntry = this.entryChannel.getDonchian();

    // Update channel (we use previous values for breakout detection)
    this.entryChannel.processCandle(candle);

    // Need previous channel values for breakout detection
    if (this.prevEntry === null) {
      return null;
    }

    // Price breaks above upper band → LONG breakout
    if (candle.close > this.prevEntry.upper) {
      return {
        direction: 'LONG',
        source: this.name,
        price: candle.close,
        timestamp: candle.closeTime,
      };
    }

    // Price breaks below lower band → SHORT breakout
    if (candle.close < this.prevEntry.lower) {
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
    this.entryChannel.reset();
    this.prevEntry = null;
  }

  // Utility getter for debugging/inspection
  getChannel(): DonchianResult | null {
    return this.entryChannel.getDonchian();
  }
}

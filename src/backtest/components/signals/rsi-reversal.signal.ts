import { Candle } from '../../types';
import { SignalGenerator, Signal, StrategyState } from '../../core/interfaces';
import { RSIIndicator } from '../../indicators';
import { ComponentMeta } from '../../core/registry';

export interface RSIReversalParams {
  period: number;
  oversold: number;
  overbought: number;
}

/**
 * Component metadata for RSI Reversal signal
 */
export const rsiReversalMeta: ComponentMeta = {
  name: 'RSI Reversal',
  description:
    'Mean reversion signal based on RSI crossing overbought/oversold levels',
  params: [
    {
      name: 'period',
      type: 'number',
      required: true,
      min: 5,
      max: 50,
      description: 'RSI calculation period',
    },
    {
      name: 'oversold',
      type: 'number',
      required: true,
      min: 10,
      max: 40,
      description: 'Oversold threshold (below this = buy signal)',
    },
    {
      name: 'overbought',
      type: 'number',
      required: true,
      min: 60,
      max: 90,
      description: 'Overbought threshold (above this = sell signal)',
    },
  ],
};

/**
 * RSI Reversal Signal Generator
 *
 * Mean reversion strategy based on RSI extreme levels:
 * - RSI crosses into oversold zone (e.g., below 30): LONG signal
 * - RSI crosses into overbought zone (e.g., above 70): SHORT signal
 *
 * Best used in ranging/sideways markets with low ADX.
 * Signal only indicates direction - composer handles position management.
 */
export class RSIReversalSignal implements SignalGenerator {
  readonly name = 'rsiReversal';

  private rsi: RSIIndicator;
  private oversold: number;
  private overbought: number;
  private prevRSI: number | null = null;

  constructor(params: RSIReversalParams) {
    this.rsi = new RSIIndicator(params.period);
    this.oversold = params.oversold;
    this.overbought = params.overbought;
  }

  processCandle(candle: Candle, _state: StrategyState): Signal | null {
    // Store previous RSI for crossover detection
    this.prevRSI = this.rsi.getRSI();

    // Calculate new RSI
    const currentRSI = this.rsi.processCandle(candle);

    // Need both current and previous RSI
    if (currentRSI === null || this.prevRSI === null) {
      return null;
    }

    // RSI crosses INTO oversold zone → LONG (mean reversion)
    if (this.prevRSI >= this.oversold && currentRSI < this.oversold) {
      return {
        direction: 'LONG',
        source: this.name,
        price: candle.close,
        timestamp: candle.closeTime,
      };
    }

    // RSI crosses INTO overbought zone → SHORT (mean reversion)
    if (this.prevRSI <= this.overbought && currentRSI > this.overbought) {
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
    this.rsi.reset();
    this.prevRSI = null;
  }

  // Utility getter for debugging/inspection
  getRSI(): number | null {
    return this.rsi.getRSI();
  }
}

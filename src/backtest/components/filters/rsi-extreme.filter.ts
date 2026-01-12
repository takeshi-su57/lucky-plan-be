import { Candle } from '../../types';
import { Filter, Signal, StrategyState } from '../../core/interfaces';
import { RSIIndicator } from '../../indicators';
import { ComponentMeta } from '../../core/registry';

export interface RSIExtremeParams {
  period: number;
  overbought: number;
  oversold: number;
}

/**
 * Component metadata for RSI Extreme filter
 */
export const rsiExtremeMeta: ComponentMeta = {
  name: 'RSI Extreme Filter',
  description: 'Blocks signals at overbought/oversold RSI levels',
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
      name: 'overbought',
      type: 'number',
      required: true,
      min: 60,
      max: 90,
      description: 'Overbought level (blocks LONG above this)',
    },
    {
      name: 'oversold',
      type: 'number',
      required: true,
      min: 10,
      max: 40,
      description: 'Oversold level (blocks SHORT below this)',
    },
  ],
};

/**
 * RSI Extreme Filter
 *
 * Blocks signals at overbought/oversold levels to avoid chasing:
 * - Blocks LONG when RSI > overbought (already overextended to upside)
 * - Blocks SHORT when RSI < oversold (already overextended to downside)
 *
 * This helps trend-following strategies avoid entering at extreme levels.
 */
export class RSIExtremeFilter implements Filter {
  readonly name = 'rsiExtreme';

  private rsi: RSIIndicator;
  private overbought: number;
  private oversold: number;

  constructor(params: RSIExtremeParams) {
    this.rsi = new RSIIndicator(params.period);
    this.overbought = params.overbought;
    this.oversold = params.oversold;
  }

  processCandle(candle: Candle): void {
    this.rsi.processCandle(candle);
  }

  shouldAllow(signal: Signal, _candle: Candle, _state: StrategyState): boolean {
    const rsiValue = this.rsi.getRSI();

    // If RSI is not ready, allow signals (conservative)
    if (rsiValue === null) return true;

    // Block LONG signals when RSI is overbought
    if (signal.direction === 'LONG' && rsiValue > this.overbought) {
      return false;
    }

    // Block SHORT signals when RSI is oversold
    if (signal.direction === 'SHORT' && rsiValue < this.oversold) {
      return false;
    }

    return true;
  }

  reset(): void {
    this.rsi.reset();
  }

  // Utility getter for debugging/inspection
  getRSI(): number | null {
    return this.rsi.getRSI();
  }
}

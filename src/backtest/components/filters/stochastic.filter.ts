import { Candle } from '../../types';
import { Filter, Signal, StrategyState } from '../../core/interfaces';
import { StochasticIndicator } from '../../indicators';
import { ComponentMeta } from '../../core/registry';

export interface StochasticFilterParams {
  kPeriod: number;
  dPeriod: number;
  smooth: number;
  overbought: number;
  oversold: number;
}

/**
 * Component metadata for Stochastic filter
 */
export const stochasticFilterMeta: ComponentMeta = {
  name: 'Stochastic Filter',
  description: 'Blocks signals at overbought/oversold Stochastic levels',
  params: [
    {
      name: 'kPeriod',
      type: 'number',
      required: true,
      min: 5,
      max: 50,
      description: '%K lookback period',
    },
    {
      name: 'dPeriod',
      type: 'number',
      required: true,
      min: 2,
      max: 10,
      description: '%D smoothing period',
    },
    {
      name: 'smooth',
      type: 'number',
      required: true,
      min: 1,
      max: 10,
      description: '%K smoothing period',
    },
    {
      name: 'overbought',
      type: 'number',
      required: true,
      min: 70,
      max: 95,
      description: 'Overbought level (blocks LONG above this)',
    },
    {
      name: 'oversold',
      type: 'number',
      required: true,
      min: 5,
      max: 30,
      description: 'Oversold level (blocks SHORT below this)',
    },
  ],
};

/**
 * Stochastic Filter
 *
 * Blocks signals at overbought/oversold Stochastic levels:
 * - Blocks LONG when %K > overbought (already overextended to upside)
 * - Blocks SHORT when %K < oversold (already overextended to downside)
 *
 * Similar to RSI filter but Stochastic is more sensitive to recent price action.
 */
export class StochasticFilter implements Filter {
  readonly name = 'stochastic';

  private stochastic: StochasticIndicator;
  private overbought: number;
  private oversold: number;

  constructor(params: StochasticFilterParams) {
    this.stochastic = new StochasticIndicator(
      params.kPeriod,
      params.dPeriod,
      params.smooth,
    );
    this.overbought = params.overbought;
    this.oversold = params.oversold;
  }

  processCandle(candle: Candle): void {
    this.stochastic.processCandle(candle);
  }

  shouldAllow(signal: Signal, _candle: Candle, _state: StrategyState): boolean {
    const stoch = this.stochastic.getStochastic();

    // If Stochastic is not ready, allow signals (conservative)
    if (stoch === null) return true;

    // Block LONG signals when Stochastic is overbought
    if (signal.direction === 'LONG' && stoch.k > this.overbought) {
      return false;
    }

    // Block SHORT signals when Stochastic is oversold
    if (signal.direction === 'SHORT' && stoch.k < this.oversold) {
      return false;
    }

    return true;
  }

  reset(): void {
    this.stochastic.reset();
  }

  // Utility getters for debugging/inspection
  getK(): number | null {
    return this.stochastic.getStochastic()?.k ?? null;
  }

  getD(): number | null {
    return this.stochastic.getStochastic()?.d ?? null;
  }
}

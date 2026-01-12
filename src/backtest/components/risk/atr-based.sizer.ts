import { Candle } from '../../types';
import {
  PositionSizer,
  PositionSize,
  Signal,
  StrategyState,
} from '../../core/interfaces';
import { ATRIndicator } from '../../indicators';
import { ComponentMeta } from '../../core/registry';

export interface ATRBasedParams {
  atrPeriod: number;
  atrMultiplier: number;
  capitalBase: number;
  useEquity: boolean;
  maxPositionPercent: number;
  riskPercent: number;
}

/**
 * Component metadata for ATR-Based Position Sizer
 */
export const atrBasedMeta: ComponentMeta = {
  name: 'ATR-Based Position Size',
  description:
    'Calculates position size based on ATR volatility and risk parameters',
  params: [
    {
      name: 'atrPeriod',
      type: 'number',
      required: true,
      min: 7,
      max: 50,
      description: 'ATR calculation period',
    },
    {
      name: 'atrMultiplier',
      type: 'number',
      required: true,
      min: 0.5,
      max: 10,
      description: 'ATR multiplier for volatility-based sizing',
    },
    {
      name: 'riskPercent',
      type: 'number',
      required: true,
      min: 0.01,
      max: 10,
      description: 'Risk per trade as percentage of capital',
    },
    {
      name: 'capitalBase',
      type: 'number',
      required: true,
      min: 100,
      description: 'Fixed capital base for position sizing',
    },
    {
      name: 'useEquity',
      type: 'boolean',
      required: true,
      description: 'Use current equity instead of fixed capital',
    },
    {
      name: 'maxPositionPercent',
      type: 'number',
      required: true,
      min: 1,
      max: 100,
      description: 'Maximum position size as percentage of capital',
    },
  ],
};

/**
 * ATR-Based Position Sizer
 *
 * Calculates position size based on ATR volatility and risk parameters.
 * Adapts to market volatility (smaller positions in volatile markets).
 *
 * Note: Stop loss is handled by StopLossExit component, not position sizer.
 */
export class ATRBasedSizer implements PositionSizer {
  readonly name = 'atrBased';

  private atr: ATRIndicator;
  private atrMultiplier: number;
  private riskPercent: number;
  private capitalBase: number;
  private useEquity: boolean;
  private maxPositionPercent: number;

  constructor(params: ATRBasedParams) {
    this.atr = new ATRIndicator(params.atrPeriod);
    this.atrMultiplier = params.atrMultiplier;
    this.riskPercent = params.riskPercent;
    this.capitalBase = params.capitalBase;
    this.useEquity = params.useEquity;
    this.maxPositionPercent = params.maxPositionPercent;
  }

  /**
   * Process candle to update ATR
   * Note: This should be called by the strategy composer
   */
  processCandle(candle: Candle): void {
    this.atr.processCandle(candle);
  }

  calculateSize(
    signal: Signal,
    _candle: Candle,
    state: StrategyState,
  ): PositionSize {
    const atrValue = this.atr.getATR();
    const capital = this.useEquity ? state.equity : this.capitalBase;

    // Fallback if ATR not ready - use fixed position size based on risk percent
    if (atrValue === null || atrValue === 0) {
      const positionValue = capital * (this.riskPercent / 100);
      const quantity = positionValue / signal.price;
      return { quantity };
    }

    // Calculate expected stop distance based on ATR
    const stopDistance = atrValue * this.atrMultiplier;

    // Calculate risk amount (how much we're willing to lose)
    const riskAmount = capital * (this.riskPercent / 100);

    // Position size in units: risk_amount / stop_distance
    // This ensures if price moves by stopDistance, we lose riskAmount
    let quantity = riskAmount / stopDistance;

    // Cap position size at maxPositionPercent of capital
    const maxPositionValue = capital * (this.maxPositionPercent / 100);
    const currentPositionValue = quantity * signal.price;

    if (currentPositionValue > maxPositionValue) {
      quantity = maxPositionValue / signal.price;
    }

    return { quantity };
  }

  reset(): void {
    this.atr.reset();
  }

  // Utility getter for debugging
  getATR(): number | null {
    return this.atr.getATR();
  }
}

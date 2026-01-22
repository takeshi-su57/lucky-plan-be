import { Candle } from '../../types';
import {
  PositionSizer,
  PositionSize,
  Signal,
  StrategyState,
} from '../../core/interfaces';
import { ATRIndicator } from '../../indicators';
import { CandleAggregator } from '../../candle-aggregator';
import { ComponentMeta } from '../../core/registry';

export interface VolatilityMarginPercentParams {
  baseMarginPercent: number; // Base margin as percentage of available capital (0-100)
  minMargin: number; // Minimum margin in USDT
  maxMargin: number; // Maximum margin in USDT
  leverage: number; // Fixed leverage multiplier
  atrPeriod: number; // ATR calculation period
  atrSmaPeriod: number; // SMA period for ATR baseline
  timeframe: number; // Timeframe in minutes for ATR calculation
  useCurrentCandle: boolean; // Whether to use incomplete candles
}

/**
 * Component metadata for Volatility-Adjusted Margin (Percentage Base) Sizer
 */
export const volatilityMarginPercentMeta: ComponentMeta = {
  name: 'Volatility-Adjusted Margin (Percentage Base)',
  description:
    'Percentage-based margin adjusted by volatility with fixed leverage. High volatility = smaller margin, low volatility = larger margin.',
  params: [
    {
      name: 'baseMarginPercent',
      type: 'number',
      required: true,
      min: 0.1,
      max: 100,
      description:
        'Base margin as percentage of available capital when volatility equals baseline (0.1-100)',
    },
    {
      name: 'minMargin',
      type: 'number',
      required: true,
      min: 10,
      description: 'Minimum margin in USDT (used in high volatility)',
    },
    {
      name: 'maxMargin',
      type: 'number',
      required: true,
      min: 100,
      description: 'Maximum margin in USDT (used in low volatility)',
    },
    {
      name: 'leverage',
      type: 'number',
      required: true,
      min: 1,
      max: 200,
      description: 'Fixed leverage multiplier',
    },
    {
      name: 'atrPeriod',
      type: 'number',
      required: true,
      min: 5,
      max: 50,
      description: 'ATR calculation period',
    },
    {
      name: 'atrSmaPeriod',
      type: 'number',
      required: true,
      min: 10,
      max: 200,
      description: 'SMA period for ATR baseline (longer = smoother baseline)',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes for ATR calculation',
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
 * Volatility-Adjusted Margin (Percentage Base) Sizer
 *
 * Uses a percentage of available capital as base margin that adapts to market volatility.
 * Volatility is measured using ATR compared to its SMA (self-adapting baseline).
 *
 * Formula:
 *   baseMargin = availableCapital * baseMarginPercent / 100
 *   volatilityRatio = SMA(ATR) / currentATR
 *   adjustedMargin = baseMargin * volatilityRatio (clamped to min/max)
 *
 * When volatility is high (currentATR > SMA): ratio < 1, margin decreases (less risk)
 * When volatility is low (currentATR < SMA): ratio > 1, margin increases (more exposure)
 */
export class VolatilityMarginPercentSizer implements PositionSizer {
  readonly name = 'volatilityMarginPercent';

  private baseMarginPercent: number;
  private minMargin: number;
  private maxMargin: number;
  private leverage: number;
  private useCurrentCandle: boolean;

  private atr: ATRIndicator;
  private aggregator: CandleAggregator | null;

  // Track ATR history for SMA calculation
  private atrHistory: number[] = [];
  private atrSmaPeriod: number;

  constructor(params: VolatilityMarginPercentParams) {
    this.baseMarginPercent = params.baseMarginPercent;
    this.minMargin = params.minMargin;
    this.maxMargin = params.maxMargin;
    this.leverage = params.leverage;
    this.atrSmaPeriod = params.atrSmaPeriod;
    this.useCurrentCandle = params.useCurrentCandle;

    this.atr = new ATRIndicator(params.atrPeriod);
    this.aggregator =
      params.timeframe > 1 ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle): void {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        this.processAtrCandle(htfCandle);
      } else if (this.useCurrentCandle) {
        const current = this.aggregator.getCurrentCandle();
        if (current) {
          this.processAtrCandle(current);
        }
      }
    } else {
      this.processAtrCandle(candle);
    }
  }

  private processAtrCandle(candle: Candle): void {
    const atrValue = this.atr.processCandle(candle);

    if (atrValue !== null) {
      this.atrHistory.push(atrValue);

      // Keep only required history for SMA calculation
      if (this.atrHistory.length > this.atrSmaPeriod) {
        this.atrHistory.shift();
      }
    }
  }

  /**
   * Calculate SMA of ATR values (baseline volatility)
   */
  private getAtrSma(): number | null {
    if (this.atrHistory.length < this.atrSmaPeriod) {
      return null;
    }

    const sum = this.atrHistory.reduce((acc, val) => acc + val, 0);
    return sum / this.atrHistory.length;
  }

  /**
   * Calculate volatility-adjusted margin based on available capital
   */
  private calculateAdjustedMargin(availableCapital: number): number {
    // Calculate base margin from available capital
    const baseMargin = availableCapital * (this.baseMarginPercent / 100);

    const currentAtr = this.atr.getATR();
    const atrSma = this.getAtrSma();

    // If not enough data, use base margin (clamped)
    if (currentAtr === null || atrSma === null || currentAtr === 0) {
      return Math.max(this.minMargin, Math.min(this.maxMargin, baseMargin));
    }

    // volatilityRatio = SMA(ATR) / currentATR
    // High volatility (currentATR > SMA) -> ratio < 1 -> smaller margin
    // Low volatility (currentATR < SMA) -> ratio > 1 -> larger margin
    const volatilityRatio = atrSma / currentAtr;
    const rawMargin = baseMargin * volatilityRatio;

    // Clamp to min/max range
    return Math.max(this.minMargin, Math.min(this.maxMargin, rawMargin));
  }

  calculateSize(
    signal: Signal,
    _candle: Candle,
    state: StrategyState,
  ): PositionSize {
    const availableCapital = state.availableCapital;

    // If no capital available, cannot open
    if (availableCapital <= 0) {
      return {
        quantity: 0,
        leverage: this.leverage,
        margin: 0,
        notionalValue: 0,
        canOpen: false,
        requestedMargin: 0,
        cappedByCapital: true,
      };
    }

    const requestedMargin = this.calculateAdjustedMargin(availableCapital);

    // Check if enough capital available
    if (availableCapital < requestedMargin) {
      return {
        quantity: 0,
        leverage: this.leverage,
        margin: 0,
        notionalValue: 0,
        canOpen: false,
        requestedMargin,
        cappedByCapital: true,
      };
    }

    // Use the requested margin (or cap to available if needed)
    const actualMargin = Math.min(requestedMargin, availableCapital);
    const cappedByCapital = actualMargin < requestedMargin;
    const notionalValue = actualMargin * this.leverage;
    const quantity = notionalValue / signal.price;

    return {
      quantity,
      leverage: this.leverage,
      margin: actualMargin,
      notionalValue,
      canOpen: true,
      requestedMargin,
      cappedByCapital,
    };
  }

  reset(): void {
    this.atr.reset();
    this.aggregator?.reset();
    this.atrHistory = [];
  }

  // Utility getters for debugging/inspection
  getATR(): number | null {
    return this.atr.getATR();
  }

  getATRSma(): number | null {
    return this.getAtrSma();
  }

  getVolatilityRatio(): number | null {
    const currentAtr = this.atr.getATR();
    const atrSma = this.getAtrSma();

    if (currentAtr === null || atrSma === null || currentAtr === 0) {
      return null;
    }

    return atrSma / currentAtr;
  }

  getCurrentMargin(availableCapital: number): number {
    return this.calculateAdjustedMargin(availableCapital);
  }
}

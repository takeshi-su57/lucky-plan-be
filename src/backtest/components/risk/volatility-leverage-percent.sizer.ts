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

export interface VolatilityLeveragePercentParams {
  marginPercent: number; // Percentage of available capital to use as margin (0-100)
  maxMargin: number; // Maximum margin in USDT to cap large positions
  baseLeverage: number; // Base leverage (used when volatility = baseline)
  minLeverage: number; // Minimum leverage
  maxLeverage: number; // Maximum leverage
  atrPeriod: number; // ATR calculation period
  atrSmaPeriod: number; // SMA period for ATR baseline
  timeframe: number; // Timeframe in minutes for ATR calculation
  useCurrentCandle: boolean; // Whether to use incomplete candles
}

/**
 * Component metadata for Volatility-Adjusted Leverage (Percentage Margin) Sizer
 */
export const volatilityLeveragePercentMeta: ComponentMeta = {
  name: 'Volatility-Adjusted Leverage (Percentage Margin)',
  description:
    'Percentage-based margin with leverage adjusted by volatility. High volatility = lower leverage, low volatility = higher leverage.',
  params: [
    {
      name: 'marginPercent',
      type: 'number',
      required: true,
      min: 0.1,
      max: 100,
      description: 'Percentage of available capital to use as margin (0.1-100)',
    },
    {
      name: 'maxMargin',
      type: 'number',
      required: true,
      min: 100,
      description: 'Maximum margin in USDT to cap large positions',
    },
    {
      name: 'baseLeverage',
      type: 'number',
      required: true,
      min: 1,
      max: 200,
      description: 'Base leverage when volatility equals baseline',
    },
    {
      name: 'minLeverage',
      type: 'number',
      required: true,
      min: 1,
      max: 200,
      description: 'Minimum leverage (used in high volatility)',
    },
    {
      name: 'maxLeverage',
      type: 'number',
      required: true,
      min: 1,
      max: 200,
      description: 'Maximum leverage (used in low volatility)',
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
 * Volatility-Adjusted Leverage (Percentage Margin) Sizer
 *
 * Uses a percentage of available capital as margin with leverage that adapts to market volatility.
 * Volatility is measured using ATR compared to its SMA (self-adapting baseline).
 *
 * Formula:
 *   margin = availableCapital * marginPercent / 100 (capped by maxMargin)
 *   volatilityRatio = SMA(ATR) / currentATR
 *   adjustedLeverage = baseLeverage * volatilityRatio (clamped to min/max)
 *
 * When volatility is high (currentATR > SMA): ratio < 1, leverage decreases
 * When volatility is low (currentATR < SMA): ratio > 1, leverage increases
 *
 * Leverage precision: 0.001 (3 decimal places)
 */
export class VolatilityLeveragePercentSizer implements PositionSizer {
  readonly name = 'volatilityLeveragePercent';

  private marginPercent: number;
  private maxMargin: number;
  private baseLeverage: number;
  private minLeverage: number;
  private maxLeverage: number;
  private useCurrentCandle: boolean;

  private atr: ATRIndicator;
  private aggregator: CandleAggregator | null;

  // Track ATR history for SMA calculation
  private atrHistory: number[] = [];
  private atrSmaPeriod: number;

  constructor(params: VolatilityLeveragePercentParams) {
    this.marginPercent = params.marginPercent;
    this.maxMargin = params.maxMargin;
    this.baseLeverage = params.baseLeverage;
    this.minLeverage = params.minLeverage;
    this.maxLeverage = params.maxLeverage;
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
   * Calculate volatility-adjusted leverage
   */
  private calculateAdjustedLeverage(): number {
    const currentAtr = this.atr.getATR();
    const atrSma = this.getAtrSma();

    // If not enough data, use base leverage
    if (currentAtr === null || atrSma === null || currentAtr === 0) {
      return this.baseLeverage;
    }

    // volatilityRatio = SMA(ATR) / currentATR
    // High volatility (currentATR > SMA) -> ratio < 1 -> lower leverage
    // Low volatility (currentATR < SMA) -> ratio > 1 -> higher leverage
    const volatilityRatio = atrSma / currentAtr;
    const rawLeverage = this.baseLeverage * volatilityRatio;

    // Clamp to min/max range
    const clampedLeverage = Math.max(
      this.minLeverage,
      Math.min(this.maxLeverage, rawLeverage),
    );

    // Round to 3 decimal places (0.001 precision)
    return Math.round(clampedLeverage * 1000) / 1000;
  }

  calculateSize(
    signal: Signal,
    _candle: Candle,
    state: StrategyState,
  ): PositionSize {
    const availableCapital = state.availableCapital;
    const leverage = this.calculateAdjustedLeverage();

    // Calculate margin as percentage of available capital
    const percentageMargin = availableCapital * (this.marginPercent / 100);

    // Apply maxMargin cap
    const requestedMargin = Math.min(percentageMargin, this.maxMargin);

    // If no capital available, cannot open
    if (availableCapital <= 0 || requestedMargin <= 0) {
      return {
        quantity: 0,
        leverage,
        margin: 0,
        notionalValue: 0,
        canOpen: false,
        requestedMargin: 0,
        cappedByCapital: true,
      };
    }

    // Check if enough capital available
    if (availableCapital < requestedMargin) {
      return {
        quantity: 0,
        leverage,
        margin: 0,
        notionalValue: 0,
        canOpen: false,
        requestedMargin,
        cappedByCapital: true,
      };
    }

    const notionalValue = requestedMargin * leverage;
    const quantity = notionalValue / signal.price;

    return {
      quantity,
      leverage,
      margin: requestedMargin,
      notionalValue,
      canOpen: true,
      requestedMargin,
      cappedByCapital: false,
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

  getCurrentLeverage(): number {
    return this.calculateAdjustedLeverage();
  }
}

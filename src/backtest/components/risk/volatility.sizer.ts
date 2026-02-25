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

export interface VolatilitySizerParams {
  // Mode selectors
  marginMode: 'fixed' | 'percentage';
  adjustmentTarget: 'leverage' | 'margin';

  // Margin params
  margin: number; // USDT (fixed mode) or percentage 0-100 (percentage mode)
  minMargin: number; // Minimum margin floor in USDT (used when adjustmentTarget='margin' or percentage mode)
  maxMargin: number; // Maximum margin cap in USDT (used when adjustmentTarget='margin' or percentage mode)

  // Leverage params
  leverage: number; // Base leverage (adjusted if adjustmentTarget='leverage', fixed otherwise)
  minLeverage: number; // Minimum leverage (floor when adjusting)
  maxLeverage: number; // Maximum leverage (cap when adjusting)

  // Volatility params
  atrPeriod: number; // ATR calculation period
  atrSmaPeriod: number; // SMA period for ATR baseline
  volatilityMultiplier: number; // Controls adjustment sensitivity (1.0 = default)
  multiplierMethod: 'exponential' | 'linear'; // Calculation method for volatility adjustment

  // Common
  timeframe: number; // Timeframe in minutes for ATR calculation
  useCurrentCandle: boolean; // Whether to use incomplete candles
}

/**
 * Component metadata for Volatility Position Sizer
 */
export const volatilitySizerMeta: ComponentMeta = {
  name: 'Volatility-Adjusted Position Sizer',
  description:
    'Position sizer with volatility-based adjustment. Can adjust either leverage or margin based on ATR.',
  params: [
    {
      name: 'marginMode',
      type: 'select',
      required: true,
      default: 'fixed',
      options: [
        { value: 'fixed', label: 'Fixed Margin (USDT)' },
        { value: 'percentage', label: 'Percentage of Capital' },
      ],
      description: 'How margin is calculated',
    },
    {
      name: 'adjustmentTarget',
      type: 'select',
      required: true,
      default: 'leverage',
      options: [
        { value: 'leverage', label: 'Adjust Leverage' },
        { value: 'margin', label: 'Adjust Margin' },
      ],
      description: 'What gets adjusted by volatility',
    },
    {
      name: 'margin',
      type: 'number',
      required: true,
      min: 0.1,
      description:
        'Margin value: USDT amount (fixed mode) or percentage 0-100 (percentage mode)',
    },
    {
      name: 'minMargin',
      type: 'number',
      required: true,
      min: 0,
      default: 0,
      description:
        'Minimum margin floor in USDT. Used when adjustmentTarget=margin or marginMode=percentage.',
    },
    {
      name: 'maxMargin',
      type: 'number',
      required: true,
      min: 0.1,
      description:
        'Maximum margin cap in USDT. Used when adjustmentTarget=margin or marginMode=percentage.',
    },
    {
      name: 'leverage',
      type: 'number',
      required: true,
      min: 1,
      max: 200,
      default: 10,
      description:
        'Base leverage (adjusted by volatility if adjustmentTarget=leverage)',
    },
    {
      name: 'minLeverage',
      type: 'number',
      required: true,
      min: 1,
      max: 200,
      default: 1,
      description: 'Minimum leverage floor',
    },
    {
      name: 'maxLeverage',
      type: 'number',
      required: true,
      min: 1,
      max: 200,
      default: 50,
      description: 'Maximum leverage cap',
    },
    {
      name: 'atrPeriod',
      type: 'number',
      required: true,
      min: 5,
      max: 50,
      default: 14,
      description: 'ATR calculation period',
    },
    {
      name: 'atrSmaPeriod',
      type: 'number',
      required: true,
      min: 10,
      max: 200,
      default: 50,
      description: 'SMA period for ATR baseline (longer = smoother)',
    },
    {
      name: 'volatilityMultiplier',
      type: 'number',
      required: true,
      min: 0,
      max: 3,
      default: 1,
      description:
        'Adjustment sensitivity: 0=no adjustment, 1=normal, 2=aggressive',
    },
    {
      name: 'multiplierMethod',
      type: 'select',
      required: true,
      default: 'exponential',
      options: [
        { value: 'exponential', label: 'Exponential (ratio^mult)' },
        { value: 'linear', label: 'Linear (1 + (ratio-1)*mult)' },
      ],
      description: 'Calculation method for volatility adjustment',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      default: 60,
      description: 'Timeframe in minutes for ATR calculation',
    },
    {
      name: 'useCurrentCandle',
      type: 'boolean',
      required: true,
      default: false,
      description: 'Whether to use incomplete candles for calculation',
    },
  ],
};

/**
 * Volatility-Adjusted Position Sizer
 *
 * Unified volatility-based position sizer that can:
 * - Use fixed or percentage-based margin
 * - Adjust either leverage or margin based on volatility
 *
 * Volatility is measured using ATR compared to its SMA (self-adapting baseline).
 *
 * Formula:
 *   volatilityRatio = SMA(ATR) / currentATR
 *   adjustedValue = baseValue × (volatilityRatio ^ volatilityMultiplier)
 *
 * When volatility is high (currentATR > SMA): ratio < 1, value decreases
 * When volatility is low (currentATR < SMA): ratio > 1, value increases
 *
 * volatilityMultiplier controls sensitivity:
 *   0 = no adjustment (always use base value)
 *   1 = normal adjustment
 *   2 = aggressive adjustment (squared effect)
 */
export class VolatilitySizer implements PositionSizer {
  readonly name = 'volatility';

  // Mode settings
  private marginMode: 'fixed' | 'percentage';
  private adjustmentTarget: 'leverage' | 'margin';

  // Margin params
  private margin: number;
  private minMargin: number;
  private maxMargin: number;

  // Leverage params
  private leverage: number;
  private minLeverage: number;
  private maxLeverage: number;

  // Volatility params
  private volatilityMultiplier: number;
  private multiplierMethod: 'exponential' | 'linear';
  private useCurrentCandle: boolean;

  // Indicators
  private atr: ATRIndicator;
  private aggregator: CandleAggregator | null;

  // ATR history for SMA calculation
  private atrHistory: number[] = [];
  private atrSmaPeriod: number;

  constructor(params: VolatilitySizerParams) {
    // Mode settings
    this.marginMode = params.marginMode;
    this.adjustmentTarget = params.adjustmentTarget;

    // Margin params
    this.margin = params.margin;
    this.minMargin = params.minMargin;
    this.maxMargin = params.maxMargin;

    // Leverage params
    this.leverage = params.leverage;
    this.minLeverage = params.minLeverage;
    this.maxLeverage = params.maxLeverage;

    // Volatility params
    this.volatilityMultiplier = params.volatilityMultiplier;
    this.multiplierMethod = params.multiplierMethod;
    this.atrSmaPeriod = params.atrSmaPeriod;
    this.useCurrentCandle = params.useCurrentCandle;

    // Initialize indicators
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
   * Calculate volatility ratio with multiplier applied
   * Returns 1.0 if not enough data or multiplier is 0
   *
   * Methods:
   * - exponential: ratio ^ multiplier (smooth curve)
   * - linear: 1 + (ratio - 1) * multiplier (direct scaling)
   */
  private calculateVolatilityFactor(): number {
    // If multiplier is 0, no adjustment
    if (this.volatilityMultiplier === 0) {
      return 1.0;
    }

    const currentAtr = this.atr.getATR();
    const atrSma = this.getAtrSma();

    // If not enough data, use base values (factor = 1)
    if (currentAtr === null || atrSma === null || currentAtr === 0) {
      return 1.0;
    }

    // volatilityRatio = SMA(ATR) / currentATR
    // High volatility (currentATR > SMA) -> ratio < 1 -> decrease
    // Low volatility (currentATR < SMA) -> ratio > 1 -> increase
    const volatilityRatio = atrSma / currentAtr;

    // Apply multiplier based on method
    if (this.multiplierMethod === 'exponential') {
      return Math.pow(volatilityRatio, this.volatilityMultiplier);
    } else {
      // linear: 1 + (ratio - 1) * multiplier
      const factor = 1 + (volatilityRatio - 1) * this.volatilityMultiplier;
      // Ensure factor doesn't go negative
      return Math.max(0, factor);
    }
  }

  /**
   * Calculate margin based on mode and volatility
   *
   * minMargin/maxMargin are both USDT:
   * - When adjustmentTarget='leverage': minMargin/maxMargin ignored (margin is static)
   * - When adjustmentTarget='margin': clamp adjusted margin to min/max (both modes)
   */
  private calculateMargin(
    availableCapital: number,
    volatilityFactor: number,
  ): number {
    if (this.marginMode === 'fixed') {
      // margin is USDT
      if (this.adjustmentTarget === 'margin') {
        // Apply volatility factor and clamp to min/max
        const adjustedMargin = this.margin * volatilityFactor;
        return Math.max(
          this.minMargin,
          Math.min(adjustedMargin, this.maxMargin),
        );
      }
      // Static margin when adjusting leverage
      return this.margin;
    } else {
      // percentage mode - margin is %
      const effectivePercent =
        this.adjustmentTarget === 'margin'
          ? this.margin * volatilityFactor
          : this.margin;

      // Calculate USDT then clamp to min/max (both USDT)
      const percentageMargin = availableCapital * (effectivePercent / 100);
      return Math.max(
        this.minMargin,
        Math.min(percentageMargin, this.maxMargin),
      );
    }
  }

  /**
   * Calculate leverage based on volatility
   */
  private calculateLeverage(volatilityFactor: number): number {
    // Apply volatility adjustment if target is leverage
    if (this.adjustmentTarget === 'leverage') {
      const adjustedLeverage = this.leverage * volatilityFactor;

      // Clamp to min/max range
      const clampedLeverage = Math.max(
        this.minLeverage,
        Math.min(this.maxLeverage, adjustedLeverage),
      );

      // Round to 3 decimal places
      return Math.round(clampedLeverage * 1000) / 1000;
    }

    // Fixed leverage when adjusting margin
    return this.leverage;
  }

  calculateSize(
    signal: Signal,
    _candle: Candle,
    state: StrategyState,
  ): PositionSize {
    const availableCapital = state.availableCapital;
    const volatilityFactor = this.calculateVolatilityFactor();

    const leverage = this.calculateLeverage(volatilityFactor);
    const requestedMargin = this.calculateMargin(
      availableCapital,
      volatilityFactor,
    );

    // If no capital or margin available, cannot open
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

  getVolatilityFactor(): number {
    return this.calculateVolatilityFactor();
  }

  getCurrentLeverage(): number {
    return this.calculateLeverage(this.calculateVolatilityFactor());
  }

  getMarginMode(): 'fixed' | 'percentage' {
    return this.marginMode;
  }

  getAdjustmentTarget(): 'leverage' | 'margin' {
    return this.adjustmentTarget;
  }

  getMultiplierMethod(): 'exponential' | 'linear' {
    return this.multiplierMethod;
  }

  getMinMargin(): number {
    return this.minMargin;
  }

  getMaxMargin(): number {
    return this.maxMargin;
  }
}

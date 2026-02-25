import { Candle } from '../../types';
import {
  PositionSizer,
  PositionSize,
  Signal,
  StrategyState,
} from '../../core/interfaces';
import { ComponentMeta } from '../../core/registry';

export interface StaticSizerParams {
  mode: 'fixed' | 'percentage';
  margin: number;
  minMargin: number; // Minimum margin floor: USDT (fixed) or % (percentage)
  maxMargin: number;
  leverage: number;
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for Static Position Sizer
 */
export const staticSizerMeta: ComponentMeta = {
  name: 'Static Position Sizer',
  description:
    'Fixed or percentage-based margin with fixed leverage. No volatility adjustment.',
  params: [
    {
      name: 'mode',
      type: 'select',
      required: true,
      default: 'fixed',
      options: [
        { value: 'fixed', label: 'Fixed Margin (USDT)' },
        { value: 'percentage', label: 'Percentage of Capital' },
      ],
      description: 'Margin calculation mode',
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
        'Minimum margin floor in USDT (used in percentage mode only). Required by some platforms.',
    },
    {
      name: 'maxMargin',
      type: 'number',
      required: true,
      min: 0.1,
      description: 'Maximum margin cap in USDT (used in percentage mode only)',
    },
    {
      name: 'leverage',
      type: 'number',
      required: true,
      min: 1,
      max: 200,
      default: 1,
      description: 'Fixed leverage multiplier',
    },
    {
      name: 'timeframe',
      type: 'number',
      required: true,
      min: 1,
      max: 1440,
      description: 'Timeframe in minutes (for API consistency)',
    },
    {
      name: 'useCurrentCandle',
      type: 'boolean',
      required: true,
      default: false,
      description: 'Whether to use incomplete candles (for API consistency)',
    },
  ],
};

/**
 * Static Position Sizer
 *
 * Combines fixed and percentage-based sizing into one component:
 *
 * - 'fixed' mode: margin = USDT amount, maxMargin is ignored
 * - 'percentage' mode: margin = percentage of capital (0-100), capped by maxMargin
 *
 * Both modes use fixed leverage. No volatility adjustment.
 */
export class StaticSizer implements PositionSizer {
  readonly name = 'static';

  private mode: 'fixed' | 'percentage';
  private margin: number;
  private minMargin: number;
  private maxMargin: number;
  private leverage: number;

  constructor(params: StaticSizerParams) {
    this.mode = params.mode;
    this.margin = params.margin;
    this.minMargin = params.minMargin;
    this.maxMargin = params.maxMargin;
    this.leverage = params.leverage;
  }

  /**
   * Calculate margin based on mode
   *
   * - fixed mode: margin is USDT, minMargin/maxMargin ignored
   * - percentage mode: margin is %, then clamp result to minMargin/maxMargin (both USDT)
   */
  private calculateMargin(availableCapital: number): number {
    if (this.mode === 'fixed') {
      // margin is USDT, ignore minMargin/maxMargin
      return this.margin;
    } else {
      // margin is %, calculate USDT then clamp to min/max (both USDT)
      const percentageMargin = availableCapital * (this.margin / 100);
      return Math.max(
        this.minMargin,
        Math.min(percentageMargin, this.maxMargin),
      );
    }
  }

  calculateSize(
    signal: Signal,
    _candle: Candle,
    state: StrategyState,
  ): PositionSize {
    const availableCapital = state.availableCapital;
    const requestedMargin = this.calculateMargin(availableCapital);

    // If no capital or margin available, cannot open
    if (availableCapital <= 0 || requestedMargin <= 0) {
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

    const notionalValue = requestedMargin * this.leverage;
    const quantity = notionalValue / signal.price;

    return {
      quantity,
      leverage: this.leverage,
      margin: requestedMargin,
      notionalValue,
      canOpen: true,
      requestedMargin,
      cappedByCapital: false,
    };
  }

  /**
   * Process candle - no-op for static sizer (no state to update)
   */
  processCandle(_candle: Candle): void {}

  /**
   * Reset - no-op for static sizer (no state to reset)
   */
  reset(): void {}

  // Utility getters for debugging/inspection
  getMode(): 'fixed' | 'percentage' {
    return this.mode;
  }

  getLeverage(): number {
    return this.leverage;
  }

  getMarginValue(): number {
    return this.margin;
  }

  getMinMargin(): number {
    return this.minMargin;
  }

  getMaxMargin(): number {
    return this.maxMargin;
  }
}

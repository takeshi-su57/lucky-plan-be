import { Candle } from '../../types';
import {
  PositionSizer,
  PositionSize,
  Signal,
  StrategyState,
} from '../../core/interfaces';
import { ComponentMeta } from '../../core/registry';

export interface PercentageBasedParams {
  marginPercent: number; // Percentage of available capital to use as margin (0-100)
  maxMargin: number; // Maximum margin in USDT to cap large positions
  leverage: number; // Leverage multiplier (default: 1)
}

/**
 * Component metadata for Percentage-Based Position Sizer
 */
export const percentageBasedMeta: ComponentMeta = {
  name: 'Percentage-Based Position Size',
  description:
    'Uses a percentage of available capital as margin per trade with optional leverage',
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
      name: 'leverage',
      type: 'number',
      required: false,
      min: 1,
      max: 200,
      default: 1,
      description: 'Leverage multiplier (1 = no leverage)',
    },
  ],
};

/**
 * Percentage-Based Position Sizer
 *
 * Uses a percentage of available capital as margin (collateral) for each trade.
 * The notional value = margin * leverage.
 *
 * Example:
 *   marginPercent = 10, availableCapital = 10000, leverage = 5
 *   margin = 10000 * 0.10 = 1000 USDT
 *   notionalValue = 1000 * 5 = 5000 USDT
 *
 * Note: Stop loss is handled by StopLossExit component, not position sizer.
 */
export class PercentageBasedSizer implements PositionSizer {
  readonly name = 'percentageBased';

  private marginPercent: number;
  private maxMargin: number;
  private leverage: number;

  constructor(params: PercentageBasedParams) {
    this.marginPercent = params.marginPercent;
    this.maxMargin = params.maxMargin;
    this.leverage = params.leverage ?? 1;
  }

  calculateSize(
    signal: Signal,
    _candle: Candle,
    state: StrategyState,
  ): PositionSize {
    const availableCapital = state.availableCapital;

    // Calculate margin as percentage of available capital
    const percentageMargin = availableCapital * (this.marginPercent / 100);

    // Apply maxMargin cap
    const requestedMargin = Math.min(percentageMargin, this.maxMargin);

    // If no capital available, cannot open
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
}

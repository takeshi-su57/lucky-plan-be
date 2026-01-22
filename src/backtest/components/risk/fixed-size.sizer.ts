import { Candle } from '../../types';
import {
  PositionSizer,
  PositionSize,
  Signal,
  StrategyState,
} from '../../core/interfaces';
import { ComponentMeta } from '../../core/registry';

export interface FixedSizeParams {
  positionSizeUsdt: number; // Fixed position size in USDT (this is the MARGIN)
  leverage: number; // Leverage multiplier (default: 1)
  timeframe: number;
  useCurrentCandle: boolean;
}

/**
 * Component metadata for Fixed Position Sizer
 */
export const fixedSizeMeta: ComponentMeta = {
  name: 'Fixed Position Size',
  description: 'Uses fixed USDT margin per trade with optional leverage',
  params: [
    {
      name: 'positionSizeUsdt',
      type: 'number',
      required: true,
      min: 100,
      description: 'Fixed margin (collateral) in USDT',
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
      description: 'Whether to use incomplete candles (for API consistency)',
    },
  ],
};

/**
 * Fixed Position Sizer
 *
 * Uses a fixed USDT margin (collateral) for all trades with optional leverage.
 * The notional value = margin * leverage.
 *
 * Note: Stop loss is handled by StopLossExit component, not position sizer.
 */
export class FixedSizeSizer implements PositionSizer {
  readonly name = 'fixed';

  private marginUsdt: number;
  private leverage: number;

  constructor(params: FixedSizeParams) {
    this.marginUsdt = params.positionSizeUsdt;
    this.leverage = params.leverage ?? 1;
  }

  calculateSize(
    signal: Signal,
    _candle: Candle,
    state: StrategyState,
  ): PositionSize {
    const requestedMargin = this.marginUsdt;
    const availableCapital = state.availableCapital;

    // Check if enough capital available
    if (availableCapital < requestedMargin) {
      // Not enough capital - cannot open position
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
}

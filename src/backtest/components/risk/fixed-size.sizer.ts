import { Candle } from '../../types';
import {
  PositionSizer,
  PositionSize,
  Signal,
  StrategyState,
} from '../../core/interfaces';
import { ComponentMeta } from '../../core/registry';

export interface FixedSizeParams {
  positionSizeUsdt: number; // Fixed position size in USDT
}

/**
 * Component metadata for Fixed Position Sizer
 */
export const fixedSizeMeta: ComponentMeta = {
  name: 'Fixed Position Size',
  description: 'Uses fixed USDT position size per trade',
  params: [
    {
      name: 'positionSizeUsdt',
      type: 'number',
      required: true,
      min: 100,
      description: 'Fixed position size in USDT',
    },
  ],
};

/**
 * Fixed Position Sizer
 *
 * Uses a fixed USDT position size for all trades.
 * This is the simplest position sizing approach.
 *
 * Note: Stop loss is handled by StopLossExit component, not position sizer.
 */
export class FixedSizeSizer implements PositionSizer {
  readonly name = 'fixed';

  private positionSizeUsdt: number;

  constructor(params: FixedSizeParams) {
    this.positionSizeUsdt = params.positionSizeUsdt;
  }

  calculateSize(
    signal: Signal,
    _candle: Candle,
    _state: StrategyState,
  ): PositionSize {
    const quantity = this.positionSizeUsdt / signal.price;
    return { quantity };
  }
}

import {
  Platform,
  OpenPositionResult,
  ClosePositionResult,
  Position,
  TradeDirection,
} from '../../core/interfaces';
import { ComponentMeta } from '../../core/registry';

export interface GeneralPlatformParams {
  openingFeePercent: number; // e.g., 0.05 = 0.05%
  closingFeePercent: number; // e.g., 0.05 = 0.05%
  spreadPercent: number; // e.g., 0.01 = 0.01%
  liquidationThreshold: number; // e.g., 90 = liquidate at 90% margin loss
}

/**
 * Component metadata for General Platform
 */
export const generalPlatformMeta: ComponentMeta = {
  name: 'General Platform',
  description:
    'Realistic perpetual futures simulation with configurable fees, spread, and liquidation threshold.',
  params: [
    {
      name: 'openingFeePercent',
      type: 'number',
      required: true,
      min: 0,
      max: 1,
      default: 0.05,
      description: 'Opening fee as percentage of notional value (0.05 = 0.05%)',
    },
    {
      name: 'closingFeePercent',
      type: 'number',
      required: true,
      min: 0,
      max: 1,
      default: 0.05,
      description: 'Closing fee as percentage of notional value (0.05 = 0.05%)',
    },
    {
      name: 'spreadPercent',
      type: 'number',
      required: true,
      min: 0,
      max: 1,
      default: 0.01,
      description: 'Spread as percentage of price (0.01 = 0.01%)',
    },
    {
      name: 'liquidationThreshold',
      type: 'number',
      required: true,
      min: 50,
      max: 100,
      default: 90,
      description:
        'Liquidation threshold as percentage of margin loss (90 = liquidate at 90% loss)',
    },
  ],
};

/**
 * General Platform
 *
 * Realistic perpetual futures trading simulation with:
 * - Configurable opening/closing fees based on notional value
 * - Configurable spread applied to entry/exit prices
 * - Configurable leverage-based liquidation threshold
 *
 * Liquidation calculation:
 * For a LONG position:
 *   liquidationPrice = entryPrice * (1 - (liquidationThreshold / 100) / leverage)
 * For a SHORT position:
 *   liquidationPrice = entryPrice * (1 + (liquidationThreshold / 100) / leverage)
 */
export class GeneralPlatform implements Platform {
  readonly name = 'general';

  private openingFeePercent: number;
  private closingFeePercent: number;
  private spreadPercent: number;
  private liquidationThreshold: number;

  constructor(params: GeneralPlatformParams) {
    this.openingFeePercent = params.openingFeePercent;
    this.closingFeePercent = params.closingFeePercent;
    this.spreadPercent = params.spreadPercent;
    this.liquidationThreshold = params.liquidationThreshold;
  }

  /**
   * Calculate costs and liquidation price for opening a position
   */
  calculateOpenPosition(
    direction: TradeDirection,
    entryPrice: number,
    notionalValue: number,
    leverage: number,
    _margin: number,
  ): OpenPositionResult {
    // Apply spread: LONG pays higher (buy at ask), SHORT pays lower (sell at bid)
    const spreadAmount = entryPrice * (this.spreadPercent / 100);
    const adjustedEntryPrice =
      direction === 'LONG'
        ? entryPrice + spreadAmount
        : entryPrice - spreadAmount;

    // Calculate opening fee based on notional value
    const openingFee = notionalValue * (this.openingFeePercent / 100);

    // Calculate liquidation price based on leverage and threshold
    // Liquidation occurs when loss reaches liquidationThreshold% of margin
    // For LONG: price must drop by (threshold / leverage)%
    // For SHORT: price must rise by (threshold / leverage)%
    const liquidationPercent = this.liquidationThreshold / 100 / leverage;
    const liquidationPrice =
      direction === 'LONG'
        ? adjustedEntryPrice * (1 - liquidationPercent)
        : adjustedEntryPrice * (1 + liquidationPercent);

    return {
      adjustedEntryPrice,
      openingFee,
      liquidationPrice,
    };
  }

  /**
   * Calculate costs and PnL for closing a position
   */
  calculateClosePosition(
    position: Position,
    exitPrice: number,
  ): ClosePositionResult {
    // Apply spread: LONG pays lower (sell at bid), SHORT pays higher (buy at ask)
    const spreadAmount = exitPrice * (this.spreadPercent / 100);
    const adjustedExitPrice =
      position.direction === 'LONG'
        ? exitPrice - spreadAmount
        : exitPrice + spreadAmount;

    // Calculate closing fee based on notional value at exit
    const exitNotionalValue = position.quantity * adjustedExitPrice;
    const closingFee = exitNotionalValue * (this.closingFeePercent / 100);

    // Calculate gross PnL (before fees)
    const priceDiff =
      position.direction === 'LONG'
        ? adjustedExitPrice - position.entryPrice
        : position.entryPrice - adjustedExitPrice;
    const grossPnl = position.quantity * priceDiff;

    // Calculate net PnL (after fees)
    // Note: Opening fee was already deducted, so we only subtract closing fee here
    const netPnl = grossPnl - closingFee;

    // PnL percent is based on margin (collateral), not notional value
    const pnlPercent = (netPnl / position.margin) * 100;

    return {
      adjustedExitPrice,
      closingFee,
      grossPnl,
      netPnl,
      pnlPercent,
    };
  }

  /**
   * Check if a position should be liquidated based on candle price range
   */
  shouldLiquidate(
    position: Position,
    candleLow: number,
    candleHigh: number,
  ): { liquidated: boolean; liquidationPrice?: number } {
    if (position.direction === 'LONG') {
      // LONG position is liquidated if candle low touches or goes below liquidation price
      if (candleLow <= position.liquidationPrice) {
        return {
          liquidated: true,
          liquidationPrice: position.liquidationPrice,
        };
      }
    } else {
      // SHORT position is liquidated if candle high touches or goes above liquidation price
      if (candleHigh >= position.liquidationPrice) {
        return {
          liquidated: true,
          liquidationPrice: position.liquidationPrice,
        };
      }
    }

    return { liquidated: false };
  }
}

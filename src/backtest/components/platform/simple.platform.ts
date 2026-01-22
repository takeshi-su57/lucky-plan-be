import {
  Platform,
  OpenPositionResult,
  ClosePositionResult,
  Position,
  TradeDirection,
} from '../../core/interfaces';
import { ComponentMeta } from '../../core/registry';

/**
 * Component metadata for Simple Platform
 */
export const simplePlatformMeta: ComponentMeta = {
  name: 'Simple Platform',
  description:
    'Clean backtest simulation with no fees, no spread, and 100% liquidation threshold. Use this for pure strategy testing without platform costs.',
  params: [],
};

/**
 * Simple Platform
 *
 * Clean backtest simulation:
 * - No opening/closing fees
 * - No spread
 * - 100% liquidation threshold (only liquidate when entire margin is lost)
 *
 * Use this for pure strategy performance testing without platform costs.
 */
export class SimplePlatform implements Platform {
  readonly name = 'simple';

  private openingFeePercent = 0;
  private closingFeePercent = 0;
  private spreadPercent = 0;
  private liquidationThreshold = 100; // 100% = only liquidate at full margin loss

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

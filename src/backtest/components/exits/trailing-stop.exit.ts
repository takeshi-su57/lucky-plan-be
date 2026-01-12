import { Candle } from '../../types';
import {
  ExitCondition,
  ExitSignal,
  Position,
  StrategyState,
} from '../../core/interfaces';
import { ATRIndicator } from '../../indicators';
import { ComponentMeta } from '../../core/registry';

export interface TrailingStopParams {
  atrPeriod: number;
  atrMultiplier: number;
  activateAfterPercent: number;
}

/**
 * Component metadata for Trailing Stop Exit
 */
export const trailingStopMeta: ComponentMeta = {
  name: 'Trailing Stop',
  description:
    'ATR-based trailing stop with initial stop and activation threshold',
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
      min: 1,
      max: 5,
      description: 'ATR multiplier for stop distance',
    },
    {
      name: 'activateAfterPercent',
      type: 'number',
      required: true,
      min: 0,
      max: 10,
      description:
        'Profit percentage required to activate trailing (0 for immediate)',
    },
  ],
};

/**
 * Trailing Stop Exit
 *
 * Exits position when price retraces by a specified ATR distance.
 *
 * Behavior:
 * - Always has an initial stop at entry +/- (ATR * multiplier)
 * - Once position reaches activateAfterPercent profit, starts trailing
 * - Trailing tracks highest (for LONG) or lowest (for SHORT) price
 *
 * This ensures protection against losses even before trailing activates.
 */
export class TrailingStopExit implements ExitCondition {
  readonly name = 'trailingStop';

  private atr: ATRIndicator;
  private multiplier: number;
  private activateAfter: number;

  // Position-specific tracking
  private highestPrice: number = 0;
  private lowestPrice: number = Infinity;
  private trailingActivated: boolean = false;
  private entryPrice: number = 0;

  constructor(params: TrailingStopParams) {
    this.atr = new ATRIndicator(params.atrPeriod);
    this.multiplier = params.atrMultiplier;
    this.activateAfter = params.activateAfterPercent;
  }

  processCandle(candle: Candle): void {
    this.atr.processCandle(candle);

    // Only update trailing prices if trailing is activated
    if (this.trailingActivated) {
      this.highestPrice = Math.max(this.highestPrice, candle.high);
      this.lowestPrice = Math.min(this.lowestPrice, candle.low);
    }
  }

  onPositionOpened(position: Position): void {
    // Reset tracking when new position opens
    this.entryPrice = position.entryPrice;
    this.highestPrice = position.entryPrice;
    this.lowestPrice = position.entryPrice;
    this.trailingActivated = this.activateAfter <= 0; // Immediately active if no threshold
  }

  shouldExit(
    position: Position,
    candle: Candle,
    _state: StrategyState,
  ): ExitSignal | null {
    const atrValue = this.atr.getATR();
    if (atrValue === null) return null;

    const trailDistance = atrValue * this.multiplier;

    // Calculate current P&L percent
    const pnlPercent =
      position.direction === 'LONG'
        ? ((candle.close - position.entryPrice) / position.entryPrice) * 100
        : ((position.entryPrice - candle.close) / position.entryPrice) * 100;

    // Check if trailing should activate (one-way: once activated, stays active)
    if (!this.trailingActivated && pnlPercent >= this.activateAfter) {
      this.trailingActivated = true;
      // Initialize trailing from current price when activating
      this.highestPrice = candle.high;
      this.lowestPrice = candle.low;
    }

    if (position.direction === 'LONG') {
      // Calculate stop price
      let stopPrice: number;
      if (this.trailingActivated) {
        // Update highest before calculating stop
        this.highestPrice = Math.max(this.highestPrice, candle.high);
        stopPrice = this.highestPrice - trailDistance;
      } else {
        // Initial stop at entry - trailDistance
        stopPrice = this.entryPrice - trailDistance;
      }

      // Exit if price hits stop
      if (candle.low <= stopPrice) {
        const exitPrice = Math.max(candle.low, stopPrice);
        const reason = this.trailingActivated
          ? `Trailing stop hit (highest: ${this.highestPrice.toFixed(2)}, stop: ${stopPrice.toFixed(2)})`
          : `Initial stop hit (entry: ${this.entryPrice.toFixed(2)}, stop: ${stopPrice.toFixed(2)})`;
        return {
          reason,
          price: exitPrice,
          timestamp: candle.closeTime,
        };
      }
    } else {
      // SHORT position
      let stopPrice: number;
      if (this.trailingActivated) {
        // Update lowest before calculating stop
        this.lowestPrice = Math.min(this.lowestPrice, candle.low);
        stopPrice = this.lowestPrice + trailDistance;
      } else {
        // Initial stop at entry + trailDistance
        stopPrice = this.entryPrice + trailDistance;
      }

      // Exit if price hits stop
      if (candle.high >= stopPrice) {
        const exitPrice = Math.min(candle.high, stopPrice);
        const reason = this.trailingActivated
          ? `Trailing stop hit (lowest: ${this.lowestPrice.toFixed(2)}, stop: ${stopPrice.toFixed(2)})`
          : `Initial stop hit (entry: ${this.entryPrice.toFixed(2)}, stop: ${stopPrice.toFixed(2)})`;
        return {
          reason,
          price: exitPrice,
          timestamp: candle.closeTime,
        };
      }
    }

    return null;
  }

  reset(): void {
    this.atr.reset();
    this.highestPrice = 0;
    this.lowestPrice = Infinity;
    this.trailingActivated = false;
    this.entryPrice = 0;
  }

  // Utility getters for debugging/inspection
  getATR(): number | null {
    return this.atr.getATR();
  }

  getHighestPrice(): number {
    return this.highestPrice;
  }

  getLowestPrice(): number {
    return this.lowestPrice;
  }

  isTrailingActivated(): boolean {
    return this.trailingActivated;
  }
}

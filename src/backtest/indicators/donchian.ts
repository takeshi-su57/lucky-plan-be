import { Candle } from '../types';

/**
 * Donchian Channel Indicator
 *
 * Donchian Channels show the highest high and lowest low over a specified period.
 * Used for breakout trading strategies (e.g., Turtle Trading system).
 *
 * - Upper Band: Highest high of the last N periods
 * - Lower Band: Lowest low of the last N periods
 * - Middle Band: Average of upper and lower
 */
export interface DonchianResult {
  upper: number;
  lower: number;
  middle: number;
}

export class DonchianIndicator {
  private period: number;
  private highs: number[] = [];
  private lows: number[] = [];
  private index: number = 0;
  private isInitialized: boolean = false;

  constructor(period: number = 20) {
    this.period = period;
    this.highs = new Array(period).fill(0);
    this.lows = new Array(period).fill(Infinity);
  }

  reset(): void {
    this.highs = new Array(this.period).fill(0);
    this.lows = new Array(this.period).fill(Infinity);
    this.index = 0;
    this.isInitialized = false;
  }

  /**
   * Process a new candle and return Donchian Channel values
   */
  processCandle(candle: Candle): DonchianResult | null {
    if (!this.isInitialized) {
      // Still filling the buffer
      this.highs[this.index] = candle.high;
      this.lows[this.index] = candle.low;
      this.index++;

      if (this.index < this.period) {
        return null;
      }

      // Buffer is now full
      this.isInitialized = true;
      this.index = 0;
    } else {
      // Update circular buffer
      this.highs[this.index] = candle.high;
      this.lows[this.index] = candle.low;
      this.index = (this.index + 1) % this.period;
    }

    const upper = Math.max(...this.highs);
    const lower = Math.min(...this.lows);
    const middle = (upper + lower) / 2;

    return { upper, lower, middle };
  }

  /**
   * Get current Donchian Channel values
   */
  getDonchian(): DonchianResult | null {
    if (!this.isInitialized) {
      return null;
    }

    const upper = Math.max(...this.highs);
    const lower = Math.min(...this.lows);
    const middle = (upper + lower) / 2;

    return { upper, lower, middle };
  }

  /**
   * Get the period
   */
  getPeriod(): number {
    return this.period;
  }
}

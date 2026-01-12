import { Candle } from '../types';

/**
 * Simple Moving Average (SMA) Indicator
 *
 * SMA calculates the average price over a specified period.
 * All prices in the period are weighted equally.
 *
 * Uses a circular buffer for memory efficiency.
 */
export class SMAIndicator {
  private period: number;
  private prices: number[] = [];
  private sum: number = 0;
  private index: number = 0;
  private isInitialized: boolean = false;

  constructor(period: number) {
    this.period = period;
    this.prices = new Array(period).fill(0);
  }

  reset(): void {
    this.prices = new Array(this.period).fill(0);
    this.sum = 0;
    this.index = 0;
    this.isInitialized = false;
  }

  /**
   * Process a new candle and return updated SMA value
   */
  processCandle(candle: Candle): number | null {
    const price = candle.close;

    if (!this.isInitialized) {
      // Still filling the buffer
      this.prices[this.index] = price;
      this.sum += price;
      this.index++;

      if (this.index < this.period) {
        return null;
      }

      // Buffer is now full
      this.isInitialized = true;
      this.index = 0;
      return this.sum / this.period;
    }

    // Remove oldest price and add new price
    this.sum -= this.prices[this.index];
    this.sum += price;
    this.prices[this.index] = price;

    // Move to next position in circular buffer
    this.index = (this.index + 1) % this.period;

    return this.sum / this.period;
  }

  /**
   * Get current SMA value
   */
  getSMA(): number | null {
    if (!this.isInitialized) {
      return null;
    }
    return this.sum / this.period;
  }

  /**
   * Get the period
   */
  getPeriod(): number {
    return this.period;
  }
}

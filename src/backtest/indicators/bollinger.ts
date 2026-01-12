import { Candle } from '../types';

/**
 * Bollinger Bands Indicator
 *
 * Bollinger Bands consist of:
 * - Middle Band: SMA of closing prices
 * - Upper Band: Middle Band + (stdDev × multiplier)
 * - Lower Band: Middle Band - (stdDev × multiplier)
 *
 * Used for volatility measurement, mean reversion, and breakout detection.
 */
export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number; // (upper - lower) / middle, normalized volatility measure
}

export class BollingerIndicator {
  private period: number;
  private stdDevMultiplier: number;
  private prices: number[] = [];
  private index: number = 0;
  private sum: number = 0;
  private isInitialized: boolean = false;

  constructor(period: number = 20, stdDevMultiplier: number = 2) {
    this.period = period;
    this.stdDevMultiplier = stdDevMultiplier;
    this.prices = new Array(period).fill(0);
  }

  reset(): void {
    this.prices = new Array(this.period).fill(0);
    this.index = 0;
    this.sum = 0;
    this.isInitialized = false;
  }

  /**
   * Process a new candle and return Bollinger Band values
   */
  processCandle(candle: Candle): BollingerResult | null {
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
    } else {
      // Update circular buffer
      this.sum -= this.prices[this.index];
      this.sum += price;
      this.prices[this.index] = price;
      this.index = (this.index + 1) % this.period;
    }

    // Calculate SMA (middle band)
    const middle = this.sum / this.period;

    // Calculate standard deviation
    let squaredDiffSum = 0;
    for (let i = 0; i < this.period; i++) {
      const diff = this.prices[i] - middle;
      squaredDiffSum += diff * diff;
    }
    const stdDev = Math.sqrt(squaredDiffSum / this.period);

    // Calculate bands
    const upper = middle + stdDev * this.stdDevMultiplier;
    const lower = middle - stdDev * this.stdDevMultiplier;
    const bandwidth = (upper - lower) / middle;

    return { upper, middle, lower, bandwidth };
  }

  /**
   * Get current Bollinger Band values
   */
  getBollinger(): BollingerResult | null {
    if (!this.isInitialized) {
      return null;
    }

    const middle = this.sum / this.period;

    let squaredDiffSum = 0;
    for (let i = 0; i < this.period; i++) {
      const diff = this.prices[i] - middle;
      squaredDiffSum += diff * diff;
    }
    const stdDev = Math.sqrt(squaredDiffSum / this.period);

    const upper = middle + stdDev * this.stdDevMultiplier;
    const lower = middle - stdDev * this.stdDevMultiplier;
    const bandwidth = (upper - lower) / middle;

    return { upper, middle, lower, bandwidth };
  }

  /**
   * Get the period
   */
  getPeriod(): number {
    return this.period;
  }
}

import { Candle } from '../types';

/**
 * Stochastic Oscillator Indicator
 *
 * Stochastic measures where the closing price is relative to the high-low range.
 *
 * - %K (Fast): (Current Close - Lowest Low) / (Highest High - Lowest Low) × 100
 * - %D (Slow): SMA of %K
 *
 * Values range from 0-100:
 * - Above 80: Overbought
 * - Below 20: Oversold
 */
export interface StochasticResult {
  k: number; // Fast stochastic
  d: number; // Slow stochastic (signal line)
}

export class StochasticIndicator {
  private kPeriod: number; // Lookback period for %K
  private dPeriod: number; // Smoothing period for %D
  private smooth: number; // Smoothing for %K (usually 3 for slow stochastic)

  private highs: number[] = [];
  private lows: number[] = [];
  private highLowIndex: number = 0;
  private highLowInitialized: boolean = false;

  private rawKValues: number[] = []; // For %K smoothing
  private rawKIndex: number = 0;
  private rawKInitialized: boolean = false;

  private kValues: number[] = []; // For %D calculation
  private kIndex: number = 0;
  private dInitialized: boolean = false;

  constructor(kPeriod: number = 14, dPeriod: number = 3, smooth: number = 3) {
    this.kPeriod = kPeriod;
    this.dPeriod = dPeriod;
    this.smooth = smooth;

    this.highs = new Array(kPeriod).fill(0);
    this.lows = new Array(kPeriod).fill(Infinity);
    this.rawKValues = new Array(smooth).fill(0);
    this.kValues = new Array(dPeriod).fill(0);
  }

  reset(): void {
    this.highs = new Array(this.kPeriod).fill(0);
    this.lows = new Array(this.kPeriod).fill(Infinity);
    this.highLowIndex = 0;
    this.highLowInitialized = false;

    this.rawKValues = new Array(this.smooth).fill(0);
    this.rawKIndex = 0;
    this.rawKInitialized = false;

    this.kValues = new Array(this.dPeriod).fill(0);
    this.kIndex = 0;
    this.dInitialized = false;
  }

  /**
   * Process a new candle and return Stochastic values
   */
  processCandle(candle: Candle): StochasticResult | null {
    // Update high-low buffer
    if (!this.highLowInitialized) {
      this.highs[this.highLowIndex] = candle.high;
      this.lows[this.highLowIndex] = candle.low;
      this.highLowIndex++;

      if (this.highLowIndex < this.kPeriod) {
        return null;
      }

      this.highLowInitialized = true;
      this.highLowIndex = 0;
    } else {
      this.highs[this.highLowIndex] = candle.high;
      this.lows[this.highLowIndex] = candle.low;
      this.highLowIndex = (this.highLowIndex + 1) % this.kPeriod;
    }

    // Calculate raw %K
    const highestHigh = Math.max(...this.highs);
    const lowestLow = Math.min(...this.lows);
    const range = highestHigh - lowestLow;

    let rawK: number;
    if (range === 0) {
      rawK = 50; // Neutral value when no range
    } else {
      rawK = ((candle.close - lowestLow) / range) * 100;
    }

    // Smooth raw %K to get %K
    if (!this.rawKInitialized) {
      this.rawKValues[this.rawKIndex] = rawK;
      this.rawKIndex++;

      if (this.rawKIndex < this.smooth) {
        return null;
      }

      this.rawKInitialized = true;
      this.rawKIndex = 0;
    } else {
      this.rawKValues[this.rawKIndex] = rawK;
      this.rawKIndex = (this.rawKIndex + 1) % this.smooth;
    }

    // Calculate smoothed %K (SMA of raw %K)
    const k = this.rawKValues.reduce((sum, val) => sum + val, 0) / this.smooth;

    // Update %K buffer for %D calculation
    if (!this.dInitialized) {
      this.kValues[this.kIndex] = k;
      this.kIndex++;

      if (this.kIndex < this.dPeriod) {
        return null;
      }

      this.dInitialized = true;
      this.kIndex = 0;
    } else {
      this.kValues[this.kIndex] = k;
      this.kIndex = (this.kIndex + 1) % this.dPeriod;
    }

    // Calculate %D (SMA of %K)
    const d = this.kValues.reduce((sum, val) => sum + val, 0) / this.dPeriod;

    return { k, d };
  }

  /**
   * Get current Stochastic values
   */
  getStochastic(): StochasticResult | null {
    if (!this.dInitialized) {
      return null;
    }

    const k = this.rawKValues.reduce((sum, val) => sum + val, 0) / this.smooth;
    const d = this.kValues.reduce((sum, val) => sum + val, 0) / this.dPeriod;

    return { k, d };
  }
}

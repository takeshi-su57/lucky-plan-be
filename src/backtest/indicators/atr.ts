import { Candle } from '../types';

/**
 * Average True Range (ATR) Indicator
 *
 * ATR measures market volatility by calculating the average of true ranges.
 * Higher ATR = higher volatility, Lower ATR = lower volatility.
 *
 * Uses Wilder's smoothing method (same as ADX).
 * Memory efficient: Only stores data needed for initialization.
 */
export class ATRIndicator {
  private period: number;
  private prevCandle: Candle | null = null;
  private initTrValues: number[] = []; // Only used during initialization
  private lastTR: number | null = null;
  private atr: number | null = null;
  private isInitialized: boolean = false;

  constructor(period: number = 14) {
    this.period = period;
  }

  reset(): void {
    this.prevCandle = null;
    this.initTrValues = [];
    this.lastTR = null;
    this.atr = null;
    this.isInitialized = false;
  }

  /**
   * Calculate True Range
   * TR = max(High - Low, |High - PrevClose|, |Low - PrevClose|)
   */
  private calculateTR(current: Candle, previous: Candle | null): number {
    const highLow = current.high - current.low;

    if (!previous) {
      return highLow;
    }

    const highPrevClose = Math.abs(current.high - previous.close);
    const lowPrevClose = Math.abs(current.low - previous.close);

    return Math.max(highLow, highPrevClose, lowPrevClose);
  }

  /**
   * Process a new candle and return updated ATR value
   */
  processCandle(candle: Candle): number | null {
    const tr = this.calculateTR(candle, this.prevCandle);
    this.prevCandle = candle;
    this.lastTR = tr;

    if (!this.isInitialized) {
      this.initTrValues.push(tr);

      if (this.initTrValues.length < this.period) {
        return null;
      }

      // First ATR is simple average of first `period` TR values
      this.atr =
        this.initTrValues.reduce((sum, val) => sum + val, 0) / this.period;
      this.isInitialized = true;
      this.initTrValues = []; // Free memory

      return this.atr;
    }

    // Wilder's smoothing: ATR = ((prevATR * (period - 1)) + TR) / period
    this.atr = (this.atr! * (this.period - 1) + tr) / this.period;

    return this.atr;
  }

  /**
   * Get current ATR value
   */
  getATR(): number | null {
    return this.atr;
  }

  /**
   * Get current True Range (last calculated)
   */
  getTR(): number | null {
    return this.lastTR;
  }

  /**
   * Get ATR as percentage of price
   * Useful for comparing volatility across different price levels
   */
  getATRPercent(currentPrice: number): number | null {
    if (this.atr === null || currentPrice === 0) {
      return null;
    }
    return (this.atr / currentPrice) * 100;
  }

  /**
   * Get the period
   */
  getPeriod(): number {
    return this.period;
  }
}

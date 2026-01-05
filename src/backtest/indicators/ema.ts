import { Candle } from '../types';

/**
 * Exponential Moving Average (EMA) Indicator
 *
 * EMA gives more weight to recent prices, making it more responsive
 * to new information compared to SMA.
 *
 * Memory efficient: Only stores prices needed for initialization.
 */
export class EMAIndicator {
  private period: number;
  private initPrices: number[] = []; // Only used during initialization
  private ema: number | null = null;
  private multiplier: number;
  private isInitialized: boolean = false;

  constructor(period: number) {
    this.period = period;
    this.multiplier = 2 / (period + 1);
  }

  reset(): void {
    this.initPrices = [];
    this.ema = null;
    this.isInitialized = false;
  }

  /**
   * Process a new candle and return updated EMA value
   */
  processCandle(candle: Candle): number | null {
    const price = candle.close;

    if (!this.isInitialized) {
      this.initPrices.push(price);

      if (this.initPrices.length < this.period) {
        return null;
      }

      // First EMA is the SMA of the first `period` prices
      this.ema =
        this.initPrices.reduce((sum, val) => sum + val, 0) / this.period;
      this.isInitialized = true;
      this.initPrices = []; // Free memory

      return this.ema;
    }

    // EMA = (Price - Previous EMA) * Multiplier + Previous EMA
    this.ema = (price - this.ema!) * this.multiplier + this.ema!;

    return this.ema;
  }

  /**
   * Get current EMA value
   */
  getEMA(): number | null {
    return this.ema;
  }

  /**
   * Get the period
   */
  getPeriod(): number {
    return this.period;
  }
}

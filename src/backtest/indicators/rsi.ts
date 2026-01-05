import { Candle } from '../types';

/**
 * Relative Strength Index (RSI) Indicator
 *
 * RSI measures momentum and identifies overbought/oversold conditions:
 * - RSI > 70: Overbought (potential sell signal)
 * - RSI < 30: Oversold (potential buy signal)
 * - RSI = 50: Neutral
 *
 * Uses Wilder's smoothing method for average gain/loss calculation.
 * Memory efficient: Only stores data needed for initialization.
 */
export class RSIIndicator {
  private period: number;
  private prevClose: number | null = null;
  private initGains: number[] = []; // Only used during initialization
  private initLosses: number[] = []; // Only used during initialization
  private avgGain: number | null = null;
  private avgLoss: number | null = null;
  private rsi: number | null = null;
  private isInitialized: boolean = false;

  constructor(period: number = 14) {
    this.period = period;
  }

  reset(): void {
    this.prevClose = null;
    this.initGains = [];
    this.initLosses = [];
    this.avgGain = null;
    this.avgLoss = null;
    this.rsi = null;
    this.isInitialized = false;
  }

  /**
   * Process a new candle and return updated RSI value
   */
  processCandle(candle: Candle): number | null {
    const close = candle.close;

    // Need previous close to calculate change
    if (this.prevClose === null) {
      this.prevClose = close;
      return null;
    }

    // Calculate price change
    const change = close - this.prevClose;
    this.prevClose = close;

    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    // Initialization phase
    if (!this.isInitialized) {
      this.initGains.push(gain);
      this.initLosses.push(loss);

      if (this.initGains.length < this.period) {
        return null;
      }

      // First average gain/loss is simple average
      this.avgGain =
        this.initGains.reduce((sum, val) => sum + val, 0) / this.period;
      this.avgLoss =
        this.initLosses.reduce((sum, val) => sum + val, 0) / this.period;
      this.isInitialized = true;
      this.initGains = []; // Free memory
      this.initLosses = []; // Free memory
    } else {
      // Wilder's smoothing: avg = (prev * (period-1) + new) / period
      this.avgGain = (this.avgGain! * (this.period - 1) + gain) / this.period;
      this.avgLoss = (this.avgLoss! * (this.period - 1) + loss) / this.period;
    }

    // Calculate RSI
    if (this.avgLoss === 0) {
      this.rsi = 100; // No losses means RSI = 100
    } else {
      const rs = this.avgGain! / this.avgLoss;
      this.rsi = 100 - 100 / (1 + rs);
    }

    return this.rsi;
  }

  /**
   * Get current RSI value
   */
  getRSI(): number | null {
    return this.rsi;
  }

  /**
   * Check if RSI indicates overbought condition
   */
  isOverbought(threshold: number = 70): boolean {
    return this.rsi !== null && this.rsi >= threshold;
  }

  /**
   * Check if RSI indicates oversold condition
   */
  isOversold(threshold: number = 30): boolean {
    return this.rsi !== null && this.rsi <= threshold;
  }

  /**
   * Get the period
   */
  getPeriod(): number {
    return this.period;
  }
}

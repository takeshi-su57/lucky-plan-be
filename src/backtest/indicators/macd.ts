import { Candle } from '../types';

/**
 * MACD (Moving Average Convergence Divergence) Indicator
 *
 * MACD consists of:
 * - MACD Line: Fast EMA - Slow EMA (typically 12 - 26)
 * - Signal Line: EMA of MACD Line (typically 9)
 * - Histogram: MACD Line - Signal Line
 *
 * Used for identifying trend direction, momentum, and potential reversals.
 */
export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

export class MACDIndicator {
  private fastPeriod: number;
  private slowPeriod: number;
  private signalPeriod: number;

  // Fast EMA state
  private fastEMA: number | null = null;
  private fastMultiplier: number;
  private fastInitPrices: number[] = [];
  private fastInitialized: boolean = false;

  // Slow EMA state
  private slowEMA: number | null = null;
  private slowMultiplier: number;
  private slowInitPrices: number[] = [];
  private slowInitialized: boolean = false;

  // Signal EMA state (EMA of MACD values)
  private signalEMA: number | null = null;
  private signalMultiplier: number;
  private signalInitValues: number[] = [];
  private signalInitialized: boolean = false;

  constructor(
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9,
  ) {
    this.fastPeriod = fastPeriod;
    this.slowPeriod = slowPeriod;
    this.signalPeriod = signalPeriod;

    this.fastMultiplier = 2 / (fastPeriod + 1);
    this.slowMultiplier = 2 / (slowPeriod + 1);
    this.signalMultiplier = 2 / (signalPeriod + 1);
  }

  reset(): void {
    this.fastEMA = null;
    this.fastInitPrices = [];
    this.fastInitialized = false;

    this.slowEMA = null;
    this.slowInitPrices = [];
    this.slowInitialized = false;

    this.signalEMA = null;
    this.signalInitValues = [];
    this.signalInitialized = false;
  }

  /**
   * Process a new candle and return MACD values
   */
  processCandle(candle: Candle): MACDResult | null {
    const price = candle.close;

    // Update fast EMA
    if (!this.fastInitialized) {
      this.fastInitPrices.push(price);
      if (this.fastInitPrices.length >= this.fastPeriod) {
        this.fastEMA =
          this.fastInitPrices.reduce((sum, val) => sum + val, 0) /
          this.fastPeriod;
        this.fastInitialized = true;
        this.fastInitPrices = [];
      }
    } else {
      this.fastEMA =
        (price - this.fastEMA!) * this.fastMultiplier + this.fastEMA!;
    }

    // Update slow EMA
    if (!this.slowInitialized) {
      this.slowInitPrices.push(price);
      if (this.slowInitPrices.length >= this.slowPeriod) {
        this.slowEMA =
          this.slowInitPrices.reduce((sum, val) => sum + val, 0) /
          this.slowPeriod;
        this.slowInitialized = true;
        this.slowInitPrices = [];
      }
    } else {
      this.slowEMA =
        (price - this.slowEMA!) * this.slowMultiplier + this.slowEMA!;
    }

    // Need both EMAs to calculate MACD
    if (!this.fastInitialized || !this.slowInitialized) {
      return null;
    }

    const macdLine = this.fastEMA! - this.slowEMA!;

    // Update signal EMA (EMA of MACD values)
    if (!this.signalInitialized) {
      this.signalInitValues.push(macdLine);
      if (this.signalInitValues.length >= this.signalPeriod) {
        this.signalEMA =
          this.signalInitValues.reduce((sum, val) => sum + val, 0) /
          this.signalPeriod;
        this.signalInitialized = true;
        this.signalInitValues = [];
      } else {
        return null;
      }
    } else {
      this.signalEMA =
        (macdLine - this.signalEMA!) * this.signalMultiplier + this.signalEMA!;
    }

    return {
      macd: macdLine,
      signal: this.signalEMA!,
      histogram: macdLine - this.signalEMA!,
    };
  }

  /**
   * Get current MACD values
   */
  getMACD(): MACDResult | null {
    if (
      !this.fastInitialized ||
      !this.slowInitialized ||
      !this.signalInitialized
    ) {
      return null;
    }

    const macdLine = this.fastEMA! - this.slowEMA!;
    return {
      macd: macdLine,
      signal: this.signalEMA!,
      histogram: macdLine - this.signalEMA!,
    };
  }
}

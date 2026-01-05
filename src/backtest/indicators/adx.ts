import { Candle } from '../types';
import { ATRIndicator } from './atr';

/**
 * Average Directional Index (ADX) Calculator
 *
 * ADX measures trend strength (not direction):
 * - ADX < 20: Weak/no trend (ranging market)
 * - ADX 20-40: Developing trend
 * - ADX 40-60: Strong trend
 * - ADX > 60: Very strong trend
 *
 * Uses ATR internally for True Range calculation.
 * Memory efficient: Only stores data needed for initialization.
 */
export class ADXIndicator {
  private period: number;
  private atrIndicator: ATRIndicator;
  private prevCandle: Candle | null = null;
  private initPlusDM: number[] = []; // Only used during DM initialization
  private initMinusDM: number[] = []; // Only used during DM initialization
  private initDX: number[] = []; // Only used during ADX initialization
  private smoothedPlusDM: number | null = null;
  private smoothedMinusDM: number | null = null;
  private adx: number | null = null;
  private dmInitialized: boolean = false;
  private adxInitialized: boolean = false;

  constructor(period: number = 14) {
    this.period = period;
    this.atrIndicator = new ATRIndicator(period);
  }

  reset(): void {
    this.atrIndicator.reset();
    this.prevCandle = null;
    this.initPlusDM = [];
    this.initMinusDM = [];
    this.initDX = [];
    this.smoothedPlusDM = null;
    this.smoothedMinusDM = null;
    this.adx = null;
    this.dmInitialized = false;
    this.adxInitialized = false;
  }

  /**
   * Calculate Directional Movement (+DM and -DM)
   */
  private calculateDM(
    current: Candle,
    previous: Candle,
  ): { plusDM: number; minusDM: number } {
    const upMove = current.high - previous.high;
    const downMove = previous.low - current.low;

    let plusDM = 0;
    let minusDM = 0;

    if (upMove > downMove && upMove > 0) {
      plusDM = upMove;
    }
    if (downMove > upMove && downMove > 0) {
      minusDM = downMove;
    }

    return { plusDM, minusDM };
  }

  /**
   * Process a new candle and return updated ADX value
   */
  processCandle(candle: Candle): number | null {
    // Process ATR (handles TR calculation and smoothing)
    const atr = this.atrIndicator.processCandle(candle);

    // Need previous candle for DM calculation
    if (!this.prevCandle) {
      this.prevCandle = candle;
      return null;
    }

    // Calculate DM
    const { plusDM, minusDM } = this.calculateDM(candle, this.prevCandle);
    this.prevCandle = candle;

    // DM Initialization phase
    if (!this.dmInitialized) {
      this.initPlusDM.push(plusDM);
      this.initMinusDM.push(minusDM);

      if (this.initPlusDM.length < this.period) {
        return null;
      }

      // First smoothed DM values are simple averages
      this.smoothedPlusDM =
        this.initPlusDM.reduce((sum, val) => sum + val, 0) / this.period;
      this.smoothedMinusDM =
        this.initMinusDM.reduce((sum, val) => sum + val, 0) / this.period;
      this.dmInitialized = true;
      this.initPlusDM = []; // Free memory
      this.initMinusDM = []; // Free memory
    } else {
      // Wilder's smoothing for DM: (prev * (period-1) + new) / period
      this.smoothedPlusDM =
        (this.smoothedPlusDM! * (this.period - 1) + plusDM) / this.period;
      this.smoothedMinusDM =
        (this.smoothedMinusDM! * (this.period - 1) + minusDM) / this.period;
    }

    // Need ATR to calculate DI
    if (atr === null || atr === 0) {
      return null;
    }

    // Calculate +DI and -DI
    // DI = (smoothedDM / ATR) * 100
    const plusDI = (this.smoothedPlusDM! / atr) * 100;
    const minusDI = (this.smoothedMinusDM! / atr) * 100;

    // Calculate DX
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;

    // ADX Initialization phase
    if (!this.adxInitialized) {
      this.initDX.push(dx);

      if (this.initDX.length < this.period) {
        return null;
      }

      // First ADX is simple average of DX
      this.adx = this.initDX.reduce((sum, val) => sum + val, 0) / this.period;
      this.adxInitialized = true;
      this.initDX = []; // Free memory

      return this.adx;
    }

    // Subsequent ADX uses Wilder's smoothing
    this.adx = (this.adx! * (this.period - 1) + dx) / this.period;

    return this.adx;
  }

  /**
   * Get current ADX value
   */
  getADX(): number | null {
    return this.adx;
  }

  /**
   * Get +DI value
   */
  getPlusDI(): number | null {
    const atr = this.atrIndicator.getATR();
    if (!this.dmInitialized || atr === null || atr === 0) return null;
    return (this.smoothedPlusDM! / atr) * 100;
  }

  /**
   * Get -DI value
   */
  getMinusDI(): number | null {
    const atr = this.atrIndicator.getATR();
    if (!this.dmInitialized || atr === null || atr === 0) return null;
    return (this.smoothedMinusDM! / atr) * 100;
  }

  /**
   * Get the underlying ATR indicator
   */
  getATRIndicator(): ATRIndicator {
    return this.atrIndicator;
  }

  /**
   * Check if ADX indicates a strong enough trend
   */
  isTrending(threshold: number = 20): boolean {
    const adx = this.getADX();
    return adx !== null && adx >= threshold;
  }
}

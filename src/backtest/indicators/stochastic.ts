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
 *
 * Supports incomplete candle processing with pending buffer pattern.
 */
export interface StochasticResult {
  k: number; // Fast stochastic
  d: number; // Slow stochastic (signal line)
}

interface StochasticState {
  highs: number[];
  lows: number[];
  highLowIndex: number;
  highLowInitialized: boolean;
  rawKValues: number[];
  rawKIndex: number;
  rawKInitialized: boolean;
  kValues: number[];
  kIndex: number;
  dInitialized: boolean;
}

export class StochasticIndicator {
  private kPeriod: number;
  private dPeriod: number;
  private smooth: number;

  private state: StochasticState;
  private committedState: StochasticState | null = null;
  private hasPending: boolean = false;

  constructor(kPeriod: number = 14, dPeriod: number = 3, smooth: number = 3) {
    this.kPeriod = kPeriod;
    this.dPeriod = dPeriod;
    this.smooth = smooth;
    this.state = this.createInitialState();
  }

  private createInitialState(): StochasticState {
    return {
      highs: new Array(this.kPeriod).fill(0),
      lows: new Array(this.kPeriod).fill(Infinity),
      highLowIndex: 0,
      highLowInitialized: false,
      rawKValues: new Array(this.smooth).fill(0),
      rawKIndex: 0,
      rawKInitialized: false,
      kValues: new Array(this.dPeriod).fill(0),
      kIndex: 0,
      dInitialized: false,
    };
  }

  reset(): void {
    this.state = this.createInitialState();
    this.committedState = null;
    this.hasPending = false;
  }

  private saveCommittedState(): void {
    this.committedState = {
      ...this.state,
      highs: [...this.state.highs],
      lows: [...this.state.lows],
      rawKValues: [...this.state.rawKValues],
      kValues: [...this.state.kValues],
    };
  }

  private restoreCommittedState(): void {
    if (!this.committedState) return;
    this.state = {
      ...this.committedState,
      highs: [...this.committedState.highs],
      lows: [...this.committedState.lows],
      rawKValues: [...this.committedState.rawKValues],
      kValues: [...this.committedState.kValues],
    };
  }

  processCandle(candle: Candle): StochasticResult | null {
    if (candle.isCompleted) {
      if (this.hasPending) {
        this.restoreCommittedState();
        this.hasPending = false;
      }
      const result = this.calculateAndUpdate(candle);
      this.saveCommittedState();
      return result;
    } else {
      if (this.hasPending) {
        this.restoreCommittedState();
      } else {
        this.saveCommittedState();
        this.hasPending = true;
      }
      return this.calculateAndUpdate(candle);
    }
  }

  private calculateAndUpdate(candle: Candle): StochasticResult | null {
    // Update high-low buffer
    if (!this.state.highLowInitialized) {
      this.state.highs[this.state.highLowIndex] = candle.high;
      this.state.lows[this.state.highLowIndex] = candle.low;
      this.state.highLowIndex++;

      if (this.state.highLowIndex < this.kPeriod) {
        return null;
      }

      this.state.highLowInitialized = true;
      this.state.highLowIndex = 0;
    } else {
      this.state.highs[this.state.highLowIndex] = candle.high;
      this.state.lows[this.state.highLowIndex] = candle.low;
      this.state.highLowIndex = (this.state.highLowIndex + 1) % this.kPeriod;
    }

    // Calculate raw %K
    const highestHigh = Math.max(...this.state.highs);
    const lowestLow = Math.min(...this.state.lows);
    const range = highestHigh - lowestLow;

    let rawK: number;
    if (range === 0) {
      rawK = 50; // Neutral value when no range
    } else {
      rawK = ((candle.close - lowestLow) / range) * 100;
    }

    // Smooth raw %K to get %K
    if (!this.state.rawKInitialized) {
      this.state.rawKValues[this.state.rawKIndex] = rawK;
      this.state.rawKIndex++;

      if (this.state.rawKIndex < this.smooth) {
        return null;
      }

      this.state.rawKInitialized = true;
      this.state.rawKIndex = 0;
    } else {
      this.state.rawKValues[this.state.rawKIndex] = rawK;
      this.state.rawKIndex = (this.state.rawKIndex + 1) % this.smooth;
    }

    // Calculate smoothed %K (SMA of raw %K)
    const k =
      this.state.rawKValues.reduce((sum, val) => sum + val, 0) / this.smooth;

    // Update %K buffer for %D calculation
    if (!this.state.dInitialized) {
      this.state.kValues[this.state.kIndex] = k;
      this.state.kIndex++;

      if (this.state.kIndex < this.dPeriod) {
        return null;
      }

      this.state.dInitialized = true;
      this.state.kIndex = 0;
    } else {
      this.state.kValues[this.state.kIndex] = k;
      this.state.kIndex = (this.state.kIndex + 1) % this.dPeriod;
    }

    // Calculate %D (SMA of %K)
    const d =
      this.state.kValues.reduce((sum, val) => sum + val, 0) / this.dPeriod;

    return { k, d };
  }

  getStochastic(): StochasticResult | null {
    if (!this.state.dInitialized) {
      return null;
    }

    const k =
      this.state.rawKValues.reduce((sum, val) => sum + val, 0) / this.smooth;
    const d =
      this.state.kValues.reduce((sum, val) => sum + val, 0) / this.dPeriod;

    return { k, d };
  }
}

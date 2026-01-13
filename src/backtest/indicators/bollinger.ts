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
 * Supports incomplete candle processing with pending buffer pattern.
 */
export interface BollingerResult {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
}

interface BollingerState {
  prices: number[];
  index: number;
  sum: number;
  isInitialized: boolean;
}

export class BollingerIndicator {
  private period: number;
  private stdDevMultiplier: number;
  private state: BollingerState;
  private committedState: BollingerState | null = null;
  private hasPending: boolean = false;

  constructor(period: number = 20, stdDevMultiplier: number = 2) {
    this.period = period;
    this.stdDevMultiplier = stdDevMultiplier;
    this.state = this.createInitialState();
  }

  private createInitialState(): BollingerState {
    return {
      prices: new Array(this.period).fill(0),
      index: 0,
      sum: 0,
      isInitialized: false,
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
      prices: [...this.state.prices],
    };
  }

  private restoreCommittedState(): void {
    if (!this.committedState) return;
    this.state = {
      ...this.committedState,
      prices: [...this.committedState.prices],
    };
  }

  processCandle(candle: Candle): BollingerResult | null {
    if (candle.isCompleted) {
      if (this.hasPending) {
        this.restoreCommittedState();
        this.hasPending = false;
      }
      const result = this.calculateAndUpdate(candle.close);
      this.saveCommittedState();
      return result;
    } else {
      if (this.hasPending) {
        this.restoreCommittedState();
      } else {
        this.saveCommittedState();
        this.hasPending = true;
      }
      return this.calculateAndUpdate(candle.close);
    }
  }

  private calculateAndUpdate(price: number): BollingerResult | null {
    if (!this.state.isInitialized) {
      this.state.prices[this.state.index] = price;
      this.state.sum += price;
      this.state.index++;

      if (this.state.index < this.period) {
        return null;
      }

      this.state.isInitialized = true;
      this.state.index = 0;
    } else {
      this.state.sum -= this.state.prices[this.state.index];
      this.state.sum += price;
      this.state.prices[this.state.index] = price;
      this.state.index = (this.state.index + 1) % this.period;
    }

    const middle = this.state.sum / this.period;

    let squaredDiffSum = 0;
    for (let i = 0; i < this.period; i++) {
      const diff = this.state.prices[i] - middle;
      squaredDiffSum += diff * diff;
    }
    const stdDev = Math.sqrt(squaredDiffSum / this.period);

    const upper = middle + stdDev * this.stdDevMultiplier;
    const lower = middle - stdDev * this.stdDevMultiplier;
    const bandwidth = (upper - lower) / middle;

    return { upper, middle, lower, bandwidth };
  }

  getBollinger(): BollingerResult | null {
    if (!this.state.isInitialized) return null;

    const middle = this.state.sum / this.period;

    let squaredDiffSum = 0;
    for (let i = 0; i < this.period; i++) {
      const diff = this.state.prices[i] - middle;
      squaredDiffSum += diff * diff;
    }
    const stdDev = Math.sqrt(squaredDiffSum / this.period);

    const upper = middle + stdDev * this.stdDevMultiplier;
    const lower = middle - stdDev * this.stdDevMultiplier;
    const bandwidth = (upper - lower) / middle;

    return { upper, middle, lower, bandwidth };
  }

  getPeriod(): number {
    return this.period;
  }
}

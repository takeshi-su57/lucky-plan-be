import { Candle } from '../types';

/**
 * Simple Moving Average (SMA) Indicator
 *
 * SMA calculates the average price over a specified period.
 * All prices in the period are weighted equally.
 *
 * Uses a circular buffer for memory efficiency.
 * Supports incomplete candle processing with pending buffer pattern.
 */

interface SMAState {
  prices: number[];
  sum: number;
  index: number;
  isInitialized: boolean;
}

export class SMAIndicator {
  private period: number;
  private state: SMAState;
  private committedState: SMAState | null = null;
  private hasPending: boolean = false;

  constructor(period: number) {
    this.period = period;
    this.state = this.createInitialState();
  }

  private createInitialState(): SMAState {
    return {
      prices: new Array(this.period).fill(0),
      sum: 0,
      index: 0,
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

  processCandle(candle: Candle): number | null {
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

  private calculateAndUpdate(price: number): number | null {
    if (!this.state.isInitialized) {
      this.state.prices[this.state.index] = price;
      this.state.sum += price;
      this.state.index++;

      if (this.state.index < this.period) {
        return null;
      }

      this.state.isInitialized = true;
      this.state.index = 0;
      return this.state.sum / this.period;
    }

    this.state.sum -= this.state.prices[this.state.index];
    this.state.sum += price;
    this.state.prices[this.state.index] = price;
    this.state.index = (this.state.index + 1) % this.period;

    return this.state.sum / this.period;
  }

  getSMA(): number | null {
    if (!this.state.isInitialized) return null;
    return this.state.sum / this.period;
  }

  getPeriod(): number {
    return this.period;
  }
}

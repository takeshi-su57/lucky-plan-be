import { Candle } from '../types';

/**
 * Donchian Channel Indicator
 *
 * Donchian Channels show the highest high and lowest low over a specified period.
 * Used for breakout trading strategies (e.g., Turtle Trading system).
 *
 * - Upper Band: Highest high of the last N periods
 * - Lower Band: Lowest low of the last N periods
 * - Middle Band: Average of upper and lower
 *
 * Supports incomplete candle processing with pending buffer pattern.
 */
export interface DonchianResult {
  upper: number;
  lower: number;
  middle: number;
}

interface DonchianState {
  highs: number[];
  lows: number[];
  index: number;
  isInitialized: boolean;
}

export class DonchianIndicator {
  private period: number;
  private state: DonchianState;
  private committedState: DonchianState | null = null;
  private hasPending: boolean = false;

  constructor(period: number = 20) {
    this.period = period;
    this.state = this.createInitialState();
  }

  private createInitialState(): DonchianState {
    return {
      highs: new Array(this.period).fill(0),
      lows: new Array(this.period).fill(Infinity),
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
      highs: [...this.state.highs],
      lows: [...this.state.lows],
    };
  }

  private restoreCommittedState(): void {
    if (!this.committedState) return;
    this.state = {
      ...this.committedState,
      highs: [...this.committedState.highs],
      lows: [...this.committedState.lows],
    };
  }

  processCandle(candle: Candle): DonchianResult | null {
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

  private calculateAndUpdate(candle: Candle): DonchianResult | null {
    if (!this.state.isInitialized) {
      this.state.highs[this.state.index] = candle.high;
      this.state.lows[this.state.index] = candle.low;
      this.state.index++;

      if (this.state.index < this.period) {
        return null;
      }

      this.state.isInitialized = true;
      this.state.index = 0;
    } else {
      this.state.highs[this.state.index] = candle.high;
      this.state.lows[this.state.index] = candle.low;
      this.state.index = (this.state.index + 1) % this.period;
    }

    const upper = Math.max(...this.state.highs);
    const lower = Math.min(...this.state.lows);
    const middle = (upper + lower) / 2;

    return { upper, lower, middle };
  }

  getDonchian(): DonchianResult | null {
    if (!this.state.isInitialized) return null;

    const upper = Math.max(...this.state.highs);
    const lower = Math.min(...this.state.lows);
    const middle = (upper + lower) / 2;

    return { upper, lower, middle };
  }

  getPeriod(): number {
    return this.period;
  }
}

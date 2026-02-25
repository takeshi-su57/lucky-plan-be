import { Candle } from '../types';

/**
 * Exponential Moving Average (EMA) Indicator
 *
 * EMA gives more weight to recent prices, making it more responsive
 * to new information compared to SMA.
 *
 * Memory efficient: Only stores prices needed for initialization.
 * Supports incomplete candle processing with pending buffer pattern.
 */

interface EMAState {
  initPrices: number[];
  ema: number | null;
  isInitialized: boolean;
}

export class EMAIndicator {
  private period: number;
  private multiplier: number;
  private state: EMAState;
  private committedState: EMAState | null = null;
  private hasPending: boolean = false;

  constructor(period: number) {
    this.period = period;
    this.multiplier = 2 / (period + 1);
    this.state = this.createInitialState();
  }

  private createInitialState(): EMAState {
    return {
      initPrices: [],
      ema: null,
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
      initPrices: [...this.state.initPrices],
    };
  }

  private restoreCommittedState(): void {
    if (!this.committedState) return;
    this.state = {
      ...this.committedState,
      initPrices: [...this.committedState.initPrices],
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
      this.state.initPrices.push(price);

      if (this.state.initPrices.length < this.period) {
        return null;
      }

      this.state.ema =
        this.state.initPrices.reduce((sum, val) => sum + val, 0) / this.period;
      this.state.isInitialized = true;
      this.state.initPrices = [];

      return this.state.ema;
    }

    this.state.ema =
      (price - this.state.ema!) * this.multiplier + this.state.ema!;
    return this.state.ema;
  }

  getEMA(): number | null {
    return this.state.ema;
  }

  getPeriod(): number {
    return this.period;
  }
}

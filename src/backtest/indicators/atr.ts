import { Candle } from '../types';

/**
 * Average True Range (ATR) Indicator
 *
 * ATR measures market volatility by calculating the average of true ranges.
 * Higher ATR = higher volatility, Lower ATR = lower volatility.
 *
 * Uses Wilder's smoothing method (same as ADX).
 * Memory efficient: Only stores data needed for initialization.
 * Supports incomplete candle processing with pending buffer pattern.
 */

interface ATRState {
  prevCandle: Candle | null;
  initTrValues: number[];
  lastTR: number | null;
  atr: number | null;
  isInitialized: boolean;
}

export class ATRIndicator {
  private period: number;
  private state: ATRState;
  private committedState: ATRState | null = null;
  private hasPending: boolean = false;

  constructor(period: number = 14) {
    this.period = period;
    this.state = this.createInitialState();
  }

  private createInitialState(): ATRState {
    return {
      prevCandle: null,
      initTrValues: [],
      lastTR: null,
      atr: null,
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
      prevCandle: this.state.prevCandle ? { ...this.state.prevCandle } : null,
      initTrValues: [...this.state.initTrValues],
    };
  }

  private restoreCommittedState(): void {
    if (!this.committedState) return;
    this.state = {
      ...this.committedState,
      prevCandle: this.committedState.prevCandle
        ? { ...this.committedState.prevCandle }
        : null,
      initTrValues: [...this.committedState.initTrValues],
    };
  }

  private calculateTR(current: Candle, previous: Candle | null): number {
    const highLow = current.high - current.low;

    if (!previous) {
      return highLow;
    }

    const highPrevClose = Math.abs(current.high - previous.close);
    const lowPrevClose = Math.abs(current.low - previous.close);

    return Math.max(highLow, highPrevClose, lowPrevClose);
  }

  processCandle(candle: Candle): number | null {
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

  private calculateAndUpdate(candle: Candle): number | null {
    const tr = this.calculateTR(candle, this.state.prevCandle);
    this.state.prevCandle = candle;
    this.state.lastTR = tr;

    if (!this.state.isInitialized) {
      this.state.initTrValues.push(tr);

      if (this.state.initTrValues.length < this.period) {
        return null;
      }

      this.state.atr =
        this.state.initTrValues.reduce((sum, val) => sum + val, 0) /
        this.period;
      this.state.isInitialized = true;
      this.state.initTrValues = [];

      return this.state.atr;
    }

    this.state.atr = (this.state.atr! * (this.period - 1) + tr) / this.period;
    return this.state.atr;
  }

  getATR(): number | null {
    return this.state.atr;
  }

  getTR(): number | null {
    return this.state.lastTR;
  }

  getATRPercent(currentPrice: number): number | null {
    if (this.state.atr === null || currentPrice === 0) {
      return null;
    }
    return (this.state.atr / currentPrice) * 100;
  }

  getPeriod(): number {
    return this.period;
  }
}

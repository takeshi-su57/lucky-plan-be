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
 * Supports incomplete candle processing with pending buffer pattern.
 */

interface RSIState {
  prevClose: number | null;
  initGains: number[];
  initLosses: number[];
  avgGain: number | null;
  avgLoss: number | null;
  rsi: number | null;
  isInitialized: boolean;
}

export class RSIIndicator {
  private period: number;
  private state: RSIState;
  private committedState: RSIState | null = null;
  private hasPending: boolean = false;

  constructor(period: number = 14) {
    this.period = period;
    this.state = this.createInitialState();
  }

  private createInitialState(): RSIState {
    return {
      prevClose: null,
      initGains: [],
      initLosses: [],
      avgGain: null,
      avgLoss: null,
      rsi: null,
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
      initGains: [...this.state.initGains],
      initLosses: [...this.state.initLosses],
    };
  }

  private restoreCommittedState(): void {
    if (!this.committedState) return;
    this.state = {
      ...this.committedState,
      initGains: [...this.committedState.initGains],
      initLosses: [...this.committedState.initLosses],
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

  private calculateAndUpdate(close: number): number | null {
    if (this.state.prevClose === null) {
      this.state.prevClose = close;
      return null;
    }

    const change = close - this.state.prevClose;
    this.state.prevClose = close;

    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (!this.state.isInitialized) {
      this.state.initGains.push(gain);
      this.state.initLosses.push(loss);

      if (this.state.initGains.length < this.period) {
        return null;
      }

      this.state.avgGain =
        this.state.initGains.reduce((sum, val) => sum + val, 0) / this.period;
      this.state.avgLoss =
        this.state.initLosses.reduce((sum, val) => sum + val, 0) / this.period;
      this.state.isInitialized = true;
      this.state.initGains = [];
      this.state.initLosses = [];
    } else {
      this.state.avgGain =
        (this.state.avgGain! * (this.period - 1) + gain) / this.period;
      this.state.avgLoss =
        (this.state.avgLoss! * (this.period - 1) + loss) / this.period;
    }

    if (this.state.avgLoss === 0) {
      this.state.rsi = 100;
    } else {
      const rs = this.state.avgGain! / this.state.avgLoss;
      this.state.rsi = 100 - 100 / (1 + rs);
    }

    return this.state.rsi;
  }

  getRSI(): number | null {
    return this.state.rsi;
  }

  isOverbought(threshold: number = 70): boolean {
    return this.state.rsi !== null && this.state.rsi >= threshold;
  }

  isOversold(threshold: number = 30): boolean {
    return this.state.rsi !== null && this.state.rsi <= threshold;
  }

  getPeriod(): number {
    return this.period;
  }
}

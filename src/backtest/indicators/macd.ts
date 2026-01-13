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
 * Supports incomplete candle processing with pending buffer pattern.
 */
export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

interface MACDState {
  fastEMA: number | null;
  fastInitPrices: number[];
  fastInitialized: boolean;
  slowEMA: number | null;
  slowInitPrices: number[];
  slowInitialized: boolean;
  signalEMA: number | null;
  signalInitValues: number[];
  signalInitialized: boolean;
}

export class MACDIndicator {
  private fastPeriod: number;
  private slowPeriod: number;
  private signalPeriod: number;
  private fastMultiplier: number;
  private slowMultiplier: number;
  private signalMultiplier: number;

  private state: MACDState;
  private committedState: MACDState | null = null;
  private hasPending: boolean = false;

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

    this.state = this.createInitialState();
  }

  private createInitialState(): MACDState {
    return {
      fastEMA: null,
      fastInitPrices: [],
      fastInitialized: false,
      slowEMA: null,
      slowInitPrices: [],
      slowInitialized: false,
      signalEMA: null,
      signalInitValues: [],
      signalInitialized: false,
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
      fastInitPrices: [...this.state.fastInitPrices],
      slowInitPrices: [...this.state.slowInitPrices],
      signalInitValues: [...this.state.signalInitValues],
    };
  }

  private restoreCommittedState(): void {
    if (!this.committedState) return;
    this.state = {
      ...this.committedState,
      fastInitPrices: [...this.committedState.fastInitPrices],
      slowInitPrices: [...this.committedState.slowInitPrices],
      signalInitValues: [...this.committedState.signalInitValues],
    };
  }

  processCandle(candle: Candle): MACDResult | null {
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

  private calculateAndUpdate(price: number): MACDResult | null {
    // Update fast EMA
    if (!this.state.fastInitialized) {
      this.state.fastInitPrices.push(price);
      if (this.state.fastInitPrices.length >= this.fastPeriod) {
        this.state.fastEMA =
          this.state.fastInitPrices.reduce((sum, val) => sum + val, 0) /
          this.fastPeriod;
        this.state.fastInitialized = true;
        this.state.fastInitPrices = [];
      }
    } else {
      this.state.fastEMA =
        (price - this.state.fastEMA!) * this.fastMultiplier +
        this.state.fastEMA!;
    }

    // Update slow EMA
    if (!this.state.slowInitialized) {
      this.state.slowInitPrices.push(price);
      if (this.state.slowInitPrices.length >= this.slowPeriod) {
        this.state.slowEMA =
          this.state.slowInitPrices.reduce((sum, val) => sum + val, 0) /
          this.slowPeriod;
        this.state.slowInitialized = true;
        this.state.slowInitPrices = [];
      }
    } else {
      this.state.slowEMA =
        (price - this.state.slowEMA!) * this.slowMultiplier +
        this.state.slowEMA!;
    }

    // Need both EMAs to calculate MACD
    if (!this.state.fastInitialized || !this.state.slowInitialized) {
      return null;
    }

    const macdLine = this.state.fastEMA! - this.state.slowEMA!;

    // Update signal EMA (EMA of MACD values)
    if (!this.state.signalInitialized) {
      this.state.signalInitValues.push(macdLine);
      if (this.state.signalInitValues.length >= this.signalPeriod) {
        this.state.signalEMA =
          this.state.signalInitValues.reduce((sum, val) => sum + val, 0) /
          this.signalPeriod;
        this.state.signalInitialized = true;
        this.state.signalInitValues = [];
      } else {
        return null;
      }
    } else {
      this.state.signalEMA =
        (macdLine - this.state.signalEMA!) * this.signalMultiplier +
        this.state.signalEMA!;
    }

    return {
      macd: macdLine,
      signal: this.state.signalEMA!,
      histogram: macdLine - this.state.signalEMA!,
    };
  }

  getMACD(): MACDResult | null {
    if (
      !this.state.fastInitialized ||
      !this.state.slowInitialized ||
      !this.state.signalInitialized
    ) {
      return null;
    }

    const macdLine = this.state.fastEMA! - this.state.slowEMA!;
    return {
      macd: macdLine,
      signal: this.state.signalEMA!,
      histogram: macdLine - this.state.signalEMA!,
    };
  }
}

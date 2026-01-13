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
 * Supports incomplete candle processing with pending buffer pattern.
 */

interface ADXState {
  prevCandle: Candle | null;
  initPlusDM: number[];
  initMinusDM: number[];
  initDX: number[];
  smoothedPlusDM: number | null;
  smoothedMinusDM: number | null;
  adx: number | null;
  dmInitialized: boolean;
  adxInitialized: boolean;
}

export class ADXIndicator {
  private period: number;
  private atrIndicator: ATRIndicator;
  private state: ADXState;
  private committedState: ADXState | null = null;
  private hasPending: boolean = false;

  constructor(period: number = 14) {
    this.period = period;
    this.atrIndicator = new ATRIndicator(period);
    this.state = this.createInitialState();
  }

  private createInitialState(): ADXState {
    return {
      prevCandle: null,
      initPlusDM: [],
      initMinusDM: [],
      initDX: [],
      smoothedPlusDM: null,
      smoothedMinusDM: null,
      adx: null,
      dmInitialized: false,
      adxInitialized: false,
    };
  }

  reset(): void {
    this.atrIndicator.reset();
    this.state = this.createInitialState();
    this.committedState = null;
    this.hasPending = false;
  }

  private saveCommittedState(): void {
    this.committedState = {
      ...this.state,
      prevCandle: this.state.prevCandle ? { ...this.state.prevCandle } : null,
      initPlusDM: [...this.state.initPlusDM],
      initMinusDM: [...this.state.initMinusDM],
      initDX: [...this.state.initDX],
    };
  }

  private restoreCommittedState(): void {
    if (!this.committedState) return;
    this.state = {
      ...this.committedState,
      prevCandle: this.committedState.prevCandle
        ? { ...this.committedState.prevCandle }
        : null,
      initPlusDM: [...this.committedState.initPlusDM],
      initMinusDM: [...this.committedState.initMinusDM],
      initDX: [...this.committedState.initDX],
    };
  }

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
    // Process ATR (handles TR calculation and smoothing)
    const atr = this.atrIndicator.processCandle(candle);

    // Need previous candle for DM calculation
    if (!this.state.prevCandle) {
      this.state.prevCandle = candle;
      return null;
    }

    // Calculate DM
    const { plusDM, minusDM } = this.calculateDM(candle, this.state.prevCandle);
    this.state.prevCandle = candle;

    // DM Initialization phase
    if (!this.state.dmInitialized) {
      this.state.initPlusDM.push(plusDM);
      this.state.initMinusDM.push(minusDM);

      if (this.state.initPlusDM.length < this.period) {
        return null;
      }

      // First smoothed DM values are simple averages
      this.state.smoothedPlusDM =
        this.state.initPlusDM.reduce((sum, val) => sum + val, 0) / this.period;
      this.state.smoothedMinusDM =
        this.state.initMinusDM.reduce((sum, val) => sum + val, 0) / this.period;
      this.state.dmInitialized = true;
      this.state.initPlusDM = [];
      this.state.initMinusDM = [];
    } else {
      // Wilder's smoothing for DM
      this.state.smoothedPlusDM =
        (this.state.smoothedPlusDM! * (this.period - 1) + plusDM) / this.period;
      this.state.smoothedMinusDM =
        (this.state.smoothedMinusDM! * (this.period - 1) + minusDM) /
        this.period;
    }

    // Need ATR to calculate DI
    if (atr === null || atr === 0) {
      return null;
    }

    // Calculate +DI and -DI
    const plusDI = (this.state.smoothedPlusDM! / atr) * 100;
    const minusDI = (this.state.smoothedMinusDM! / atr) * 100;

    // Calculate DX
    const diSum = plusDI + minusDI;
    const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;

    // ADX Initialization phase
    if (!this.state.adxInitialized) {
      this.state.initDX.push(dx);

      if (this.state.initDX.length < this.period) {
        return null;
      }

      // First ADX is simple average of DX
      this.state.adx =
        this.state.initDX.reduce((sum, val) => sum + val, 0) / this.period;
      this.state.adxInitialized = true;
      this.state.initDX = [];

      return this.state.adx;
    }

    // Subsequent ADX uses Wilder's smoothing
    this.state.adx = (this.state.adx! * (this.period - 1) + dx) / this.period;

    return this.state.adx;
  }

  getADX(): number | null {
    return this.state.adx;
  }

  getPlusDI(): number | null {
    const atr = this.atrIndicator.getATR();
    if (!this.state.dmInitialized || atr === null || atr === 0) return null;
    return (this.state.smoothedPlusDM! / atr) * 100;
  }

  getMinusDI(): number | null {
    const atr = this.atrIndicator.getATR();
    if (!this.state.dmInitialized || atr === null || atr === 0) return null;
    return (this.state.smoothedMinusDM! / atr) * 100;
  }

  getATRIndicator(): ATRIndicator {
    return this.atrIndicator;
  }

  isTrending(threshold: number = 20): boolean {
    const adx = this.getADX();
    return adx !== null && adx >= threshold;
  }
}

import { Candle } from './types';

/**
 * Parse interval string to minutes
 * e.g., "1m" -> 1, "5m" -> 5, "1h" -> 60, "4h" -> 240, "1d" -> 1440
 */
export function parseIntervalToMinutes(interval: string): number {
  const match = interval.match(/^(\d+)([smhdwM])$/);
  if (!match) {
    throw new Error(`Invalid interval format: ${interval}`);
  }

  const value = parseInt(match[1], 10);
  const unit = match[2];

  switch (unit) {
    case 's':
      return value / 60; // seconds to minutes (fractional)
    case 'm':
      return value;
    case 'h':
      return value * 60;
    case 'd':
      return value * 60 * 24;
    case 'w':
      return value * 60 * 24 * 7;
    case 'M':
      return value * 60 * 24 * 30; // approximate
    default:
      throw new Error(`Unknown interval unit: ${unit}`);
  }
}

/**
 * Stream pipe that aggregates candles from source interval to target interval
 *
 * @param source - Source async generator of candles (e.g., 1m candles)
 * @param targetInterval - Target interval string (e.g., "5m", "1h", "4h")
 * @yields Aggregated candles at the target interval
 *
 * @example
 * const source = streamPriceData(symbol, '1m', fromDate, toDate);
 * const hourlyStream = aggregateCandleStream(source, '1h');
 * for await (const candle of hourlyStream) {
 *   // process 1h candles
 * }
 */
export async function* aggregateCandleStream(
  source: AsyncGenerator<Candle, void, unknown>,
  targetInterval: string,
): AsyncGenerator<Candle, void, unknown> {
  const targetMinutes = parseIntervalToMinutes(targetInterval);
  const aggregator = new CandleAggregator(targetMinutes);

  try {
    for await (const candle of source) {
      const completed = aggregator.processCandle(candle);
      if (completed) {
        yield completed;
      }
    }

    // Yield final incomplete candle if exists
    const final = aggregator.getCurrentCandle();
    if (final) {
      yield final;
    }
  } finally {
    // Ensure cleanup even if consumer breaks early
    aggregator.reset();
  }
}

/**
 * Aggregates lower timeframe candles into higher timeframe candles
 * e.g., 1m candles -> 1h candles
 *
 * Memory efficient: Only stores current period candles, not history.
 */
export class CandleAggregator {
  private periodMinutes: number;
  private currentPeriodStart: number = 0;
  // Only store OHLCV for current period (not individual candles)
  private currentOpen: number = 0;
  private currentHigh: number = 0;
  private currentLow: number = Infinity;
  private currentClose: number = 0;
  private currentVolume: number = 0;
  private currentOpenTime: number = 0;
  private currentCloseTime: number = 0;
  private hasData: boolean = false;

  /**
   * @param periodMinutes - Target timeframe in minutes (e.g., 60 for 1h)
   */
  constructor(periodMinutes: number = 60) {
    this.periodMinutes = periodMinutes;
  }

  /**
   * Reset the aggregator state
   */
  reset(): void {
    this.currentPeriodStart = 0;
    this.currentOpen = 0;
    this.currentHigh = 0;
    this.currentLow = Infinity;
    this.currentClose = 0;
    this.currentVolume = 0;
    this.currentOpenTime = 0;
    this.currentCloseTime = 0;
    this.hasData = false;
  }

  /**
   * Get the period start time for a given timestamp
   */
  private getPeriodStart(timestamp: number): number {
    const periodMs = this.periodMinutes * 60 * 1000;
    return Math.floor(timestamp / periodMs) * periodMs;
  }

  /**
   * Start a new period with a candle
   */
  private startNewPeriod(candle: Candle): void {
    this.currentOpen = candle.open;
    this.currentHigh = candle.high;
    this.currentLow = candle.low;
    this.currentClose = candle.close;
    this.currentVolume = candle.volume;
    this.currentOpenTime = candle.openTime;
    this.currentCloseTime = candle.closeTime;
    this.hasData = true;
  }

  /**
   * Update current period with a candle
   */
  private updateCurrentPeriod(candle: Candle): void {
    this.currentHigh = Math.max(this.currentHigh, candle.high);
    this.currentLow = Math.min(this.currentLow, candle.low);
    this.currentClose = candle.close;
    this.currentVolume += candle.volume;
    this.currentCloseTime = candle.closeTime;
  }

  /**
   * Build candle from current state
   * @param isCompleted - Whether the candle period is complete
   */
  private buildCandle(isCompleted: boolean): Candle | null {
    if (!this.hasData) return null;

    return {
      openTime: this.currentOpenTime,
      open: this.currentOpen,
      high: this.currentHigh,
      low: this.currentLow,
      close: this.currentClose,
      volume: this.currentVolume,
      closeTime: this.currentCloseTime,
      isCompleted,
    };
  }

  /**
   * Process a new 1m candle
   * Returns completed higher timeframe candle if period is complete, null otherwise
   */
  processCandle(candle: Candle): Candle | null {
    const periodStart = this.getPeriodStart(candle.openTime);

    // New period started
    if (periodStart !== this.currentPeriodStart) {
      // Get completed candle from previous period (isCompleted: true)
      const completedCandle = this.buildCandle(true);

      // Start new period
      this.currentPeriodStart = periodStart;
      this.startNewPeriod(candle);

      return completedCandle;
    }

    // Same period - update OHLCV
    this.updateCurrentPeriod(candle);
    return null;
  }

  /**
   * Get the current incomplete candle (for real-time calculation)
   * Returns candle with isCompleted: false
   */
  getCurrentCandle(): Candle | null {
    return this.buildCandle(false);
  }
}

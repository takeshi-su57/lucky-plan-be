import { Candle, StrategySignal, StrategyConfig } from './types';
import { CandleAggregator } from './candle-aggregator';
import { EMAIndicator, ADXIndicator } from './indicators';

/**
 * Trend Following Strategy using dual EMA crossover with optional ADX filter
 *
 * - Buy signal: Short EMA crosses above Long EMA (and ADX > threshold if enabled)
 * - Sell signal: Short EMA crosses below Long EMA (and ADX > threshold if enabled)
 *
 * ADX is calculated on higher timeframe candles (e.g., 1h) derived from 1m data
 */
export class TrendFollowingStrategy {
  private config: StrategyConfig;

  // EMA indicators
  private shortEmaIndicator: EMAIndicator;
  private longEmaIndicator: EMAIndicator;
  private prevShortEma: number | null = null;
  private prevLongEma: number | null = null;

  // ADX components
  private candleAggregator: CandleAggregator | null = null;
  private adxIndicator: ADXIndicator | null = null;

  constructor(config?: Partial<StrategyConfig>) {
    this.config = {
      shortPeriod: config?.shortPeriod ?? 20,
      longPeriod: config?.longPeriod ?? 50,
      useAdxFilter: config?.useAdxFilter ?? false,
      adxPeriod: config?.adxPeriod ?? 14,
      adxThreshold: config?.adxThreshold ?? 20,
      adxTimeframeMinutes: config?.adxTimeframeMinutes ?? 60,
    };

    // Initialize EMA indicators
    this.shortEmaIndicator = new EMAIndicator(this.config.shortPeriod);
    this.longEmaIndicator = new EMAIndicator(this.config.longPeriod);

    // Initialize ADX components if filter is enabled
    if (this.config.useAdxFilter) {
      this.candleAggregator = new CandleAggregator(
        this.config.adxTimeframeMinutes,
      );
      this.adxIndicator = new ADXIndicator(this.config.adxPeriod);
    }
  }

  reset(): void {
    this.shortEmaIndicator.reset();
    this.longEmaIndicator.reset();
    this.prevShortEma = null;
    this.prevLongEma = null;

    if (this.candleAggregator) {
      this.candleAggregator.reset();
    }
    if (this.adxIndicator) {
      this.adxIndicator.reset();
    }
  }

  /**
   * Update ADX with the current 1m candle
   * Returns current ADX value (using dynamic current candle for real-time calculation)
   */
  private updateAdx(candle: Candle): number | null {
    if (!this.candleAggregator || !this.adxIndicator) {
      return null;
    }

    // Process the 1m candle through aggregator
    const completedCandle = this.candleAggregator.processCandle(candle);

    // If a higher timeframe candle completed, process it through ADX
    if (completedCandle) {
      this.adxIndicator.processCandle(completedCandle);
    }

    // Get current incomplete candle for real-time ADX calculation
    const currentCandle = this.candleAggregator.getCurrentCandle();
    if (!currentCandle) {
      return this.adxIndicator.getADX();
    }

    // Calculate ADX including the dynamic current candle
    // We need to temporarily process it without modifying state
    // So we return the current ADX value (from completed candles)
    // This is a simplification - for more accurate real-time,
    // we'd need to clone the indicator state
    return this.adxIndicator.getADX();
  }

  /**
   * Check if ADX filter allows trading
   */
  private isAdxAllowingTrade(): boolean {
    if (!this.config.useAdxFilter || !this.adxIndicator) {
      return true; // No filter = always allow
    }
    return this.adxIndicator.isTrending(this.config.adxThreshold);
  }

  /**
   * Process a new candle and generate a signal
   */
  processCandle(candle: Candle): StrategySignal {
    // Update ADX if filter is enabled
    if (this.config.useAdxFilter) {
      this.updateAdx(candle);
    }

    // Store previous EMAs for crossover detection
    this.prevShortEma = this.shortEmaIndicator.getEMA();
    this.prevLongEma = this.longEmaIndicator.getEMA();

    // Calculate new EMAs
    const shortEma = this.shortEmaIndicator.processCandle(candle);
    const longEma = this.longEmaIndicator.processCandle(candle);

    // Default signal
    const signal: StrategySignal = {
      action: 'HOLD',
      price: candle.close,
      time: candle.closeTime,
    };

    // Need both EMAs to generate signals
    if (
      shortEma === null ||
      longEma === null ||
      this.prevShortEma === null ||
      this.prevLongEma === null
    ) {
      return signal;
    }

    // Detect crossovers
    const wasBelow = this.prevShortEma < this.prevLongEma;
    const wasAbove = this.prevShortEma > this.prevLongEma;
    const isBelow = shortEma < longEma;
    const isAbove = shortEma > longEma;

    // Check if ADX allows trading (trend is strong enough)
    const adxAllows = this.isAdxAllowingTrade();

    // Golden cross: Short EMA crosses above Long EMA -> BUY
    if (wasBelow && isAbove && adxAllows) {
      signal.action = 'BUY';
    }
    // Death cross: Short EMA crosses below Long EMA -> SELL
    else if (wasAbove && isBelow && adxAllows) {
      signal.action = 'SELL';
    }

    return signal;
  }

  getShortEma(): number | null {
    return this.shortEmaIndicator.getEMA();
  }

  getLongEma(): number | null {
    return this.longEmaIndicator.getEMA();
  }

  getADX(): number | null {
    return this.adxIndicator?.getADX() ?? null;
  }

  getPlusDI(): number | null {
    return this.adxIndicator?.getPlusDI() ?? null;
  }

  getMinusDI(): number | null {
    return this.adxIndicator?.getMinusDI() ?? null;
  }

  getConfig(): StrategyConfig {
    return { ...this.config };
  }
}

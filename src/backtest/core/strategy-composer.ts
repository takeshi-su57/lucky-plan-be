import { Candle } from '../types';
import {
  SignalGenerator,
  Filter,
  PositionSizer,
  ExitCondition,
  StrategyConfig,
  StrategyState,
  TradeAction,
  Position,
} from './interfaces';
import { registry } from './registry';

// Import components to ensure they're registered
import '../components';

/**
 * ComposableStrategy
 *
 * Composes multiple components (signals, filters, risk, exits) into
 * a complete trading strategy based on configuration.
 *
 * Execution flow per candle:
 * 1. Update all component internal states
 * 2. Generate signal from signal generator
 * 3. If in position:
 *    a. Check for CLOSE signal from signal generator (strategy-based exit)
 *    b. Check exit conditions (risk management exits)
 * 4. If not in position:
 *    a. Check for OPEN signal
 *    b. Apply filters
 *    c. Calculate position size
 */
export class ComposableStrategy {
  private config: StrategyConfig;
  private signal: SignalGenerator;
  private filters: Filter[];
  private positionSizer: PositionSizer;
  private exits: ExitCondition[];
  private state: StrategyState;

  constructor(
    signal: SignalGenerator,
    filters: Filter[],
    positionSizer: PositionSizer,
    exits: ExitCondition[],
    config: StrategyConfig,
  ) {
    this.signal = signal;
    this.filters = filters;
    this.positionSizer = positionSizer;
    this.exits = exits;
    this.config = config;
    this.state = {
      position: null,
      indicators: new Map(),
      lastSignal: null,
      equity: config.settings?.capitalBase ?? 10000,
    };
  }

  /**
   * Create a ComposableStrategy from a configuration object
   */
  static fromConfig(config: StrategyConfig): ComposableStrategy {
    // Build signal generator
    const signalEntry = registry.signals[config.signal.type];
    if (!signalEntry) {
      throw new Error(`Unknown signal type: ${config.signal.type}`);
    }
    const signal = signalEntry.factory(config.signal.params);

    // Build filters
    const filters = config.filters.map((f) => {
      const entry = registry.filters[f.type];
      if (!entry) {
        throw new Error(`Unknown filter type: ${f.type}`);
      }
      return entry.factory(f.params);
    });

    // Build position sizer
    const riskEntry = registry.risk[config.risk.type];
    if (!riskEntry) {
      throw new Error(`Unknown risk type: ${config.risk.type}`);
    }
    const positionSizer = riskEntry.factory(config.risk.params);

    // Build exit conditions
    const exits = config.exits.map((e) => {
      const entry = registry.exits[e.type];
      if (!entry) {
        throw new Error(`Unknown exit type: ${e.type}`);
      }
      return entry.factory(e.params);
    });

    return new ComposableStrategy(
      signal,
      filters,
      positionSizer,
      exits,
      config,
    );
  }

  /**
   * Process a candle and return any trade action
   *
   * Flow:
   * 1. Update all component internal states
   * 2. Generate signal from signal generator
   * 3. If in position:
   *    a. Check for opposite direction signal (position flip)
   *    b. Check exit conditions (risk management)
   * 4. If not in position:
   *    a. Check for entry signal
   *    b. Apply filters
   *    c. Calculate position size
   */
  processCandle(candle: Candle): TradeAction | null {
    // 1. Update all component internal states
    this.filters.forEach((f) => f.processCandle(candle));
    this.exits.forEach((e) => e.processCandle(candle));

    // Update position sizer if it has processCandle method
    if ('processCandle' in this.positionSizer) {
      (this.positionSizer as any).processCandle(candle);
    }

    // 2. Generate signal from signal generator
    const signal = this.signal.processCandle(candle, this.state);

    // 3. If in position
    if (this.state.position) {
      // 3a. Check for opposite direction signal (position flip)
      if (signal && signal.direction !== this.state.position.direction) {
        // Apply filters for the new direction
        const passesAllFilters = this.filters.every((f) =>
          f.shouldAllow(signal, candle, this.state),
        );

        if (passesAllFilters) {
          // Calculate position size for new direction
          const size = this.positionSizer.calculateSize(
            signal,
            candle,
            this.state,
          );

          // Store last signal in state
          this.state.lastSignal = signal;

          // Return ENTRY - engine will handle closing current position first
          return {
            type: 'ENTRY',
            direction: signal.direction,
            price: signal.price,
            quantity: size.quantity,
            signalSource: signal.source,
            timestamp: signal.timestamp,
          };
        }
      }

      // 3b. Check exit conditions (risk management exits)
      for (const exit of this.exits) {
        const exitSignal = exit.shouldExit(
          this.state.position,
          candle,
          this.state,
        );
        if (exitSignal) {
          return {
            type: 'EXIT',
            reason: exitSignal.reason,
            price: exitSignal.price,
            timestamp: exitSignal.timestamp,
          };
        }
      }

      // Same direction signal or no signal - stay in position
      return null;
    }

    // 4. Not in position - check for entry signal
    if (!signal) return null;

    // 5. Apply all filters (ALL must pass)
    const passesAllFilters = this.filters.every((f) =>
      f.shouldAllow(signal, candle, this.state),
    );
    if (!passesAllFilters) return null;

    // 6. Calculate position size
    const size = this.positionSizer.calculateSize(signal, candle, this.state);

    // Store last signal in state
    this.state.lastSignal = signal;

    return {
      type: 'ENTRY',
      direction: signal.direction,
      price: signal.price,
      quantity: size.quantity,
      signalSource: signal.source,
      timestamp: signal.timestamp,
    };
  }

  /**
   * Update the internal position state
   * Called by backtest engine when position is opened/closed
   */
  setPosition(position: Position | null): void {
    this.state.position = position;

    // Notify exits when position is opened
    if (position) {
      this.exits.forEach((exit) => {
        if (exit.onPositionOpened) {
          exit.onPositionOpened(position);
        }
      });
    }
  }

  /**
   * Update equity in state
   */
  setEquity(equity: number): void {
    this.state.equity = equity;
  }

  /**
   * Reset all components to initial state
   */
  reset(): void {
    this.signal.reset();
    this.filters.forEach((f) => f.reset());
    this.exits.forEach((e) => e.reset());

    if ('reset' in this.positionSizer) {
      (this.positionSizer as any).reset();
    }

    this.state = {
      position: null,
      indicators: new Map(),
      lastSignal: null,
      equity: this.config.settings?.capitalBase ?? 10000,
    };
  }

  /**
   * Get the strategy configuration
   */
  getConfig(): StrategyConfig {
    return this.config;
  }

  /**
   * Get the current strategy state
   */
  getState(): StrategyState {
    return this.state;
  }

  /**
   * Get strategy name
   */
  getName(): string {
    return this.config.name;
  }

  /**
   * Get strategy symbol
   */
  getSymbol(): string {
    return this.config.symbol;
  }
}

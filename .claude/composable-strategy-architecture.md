# Composable Strategy Architecture

A flexible, plugin-based architecture for supporting multiple trading pairs with different strategy configurations.

## Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      STRATEGY CONFIG (per pair)                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐  │
│  │  Signals[]  │ │  Filters[]  │ │    Risk     │ │  Exits[]  │  │
│  │ OPEN/CLOSE  │ │   confirm   │ │  position   │ │   risk    │  │
│  │  strategy   │ │   entries   │ │   sizing    │ │management │  │
│  └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     COMPONENT REGISTRY                           │
│  signals: { emaCrossover, breakout, rsiReversal, ... }          │
│  filters: { adxTrend, volatility, timeOfDay, ... }              │
│  risk:    { fixedSize, atrBased, kellyBased, ... }              │
│  exits:   { trailingStop, takeProfit, timeBasedExit, ... }      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     STRATEGY ENGINE                              │
│  Composes components based on config, orchestrates execution     │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Examples |
|-----------|----------------|----------|
| **Signals** | Strategy logic for OPENING and CLOSING positions | EMA crossover opens on cross, closes on reverse cross |
| **Filters** | Confirm/reject OPEN signals only | ADX trend strength, RSI overbought/oversold |
| **Risk** | Calculate position size and initial stop loss | ATR-based sizing, fixed size, percent equity |
| **Exits** | Risk management / special exit handlers | Trailing stop, take profit, time-based exit |

**Key Distinction**: Signals handle the core strategy logic (when to enter AND exit based on indicators). Exits are supplementary risk management tools that can force an exit regardless of signal state (e.g., trailing stop hit, max holding time reached).

## Core Interfaces

```typescript
// Signal Generator - produces entry AND exit signals based on strategy logic
interface SignalGenerator {
  name: string;
  processCandle(candle: Candle, state: StrategyState): Signal | null;
  reset(): void;
}

// Filter - confirms or rejects signals
interface Filter {
  name: string;
  shouldAllow(signal: Signal, candle: Candle, state: StrategyState): boolean;
  processCandle(candle: Candle): void;
  reset(): void;
}

// Position Sizer - calculates position size
interface PositionSizer {
  name: string;
  calculateSize(signal: Signal, candle: Candle, state: StrategyState): PositionSize;
}

// Exit Condition - risk management handlers (trailing stop, take profit, time-based, etc.)
// These are SPECIAL exit conditions, not primary strategy logic
interface ExitCondition {
  name: string;
  shouldExit(position: Position, candle: Candle, state: StrategyState): ExitSignal | null;
  processCandle(candle: Candle): void;
  reset(): void;
}

// Supporting types
interface Signal {
  action: 'OPEN' | 'CLOSE';      // Whether to open or close a position
  direction: 'LONG' | 'SHORT';   // Position direction
  source: string;
  strength?: number;
  price: number;
  timestamp: number;
}

interface ExitSignal {
  reason: string;
  price: number;
  timestamp: number;
}

interface PositionSize {
  quantity: number;
  stopLoss: number;
  riskAmount: number;
}

interface StrategyState {
  position: Position | null;
  indicators: Map<string, any>;
  lastSignal: Signal | null;
}
```

## Component Registry

```typescript
type ComponentFactory<T> = (params: Record<string, any>) => T;

interface ComponentRegistry {
  signals: Record<string, ComponentFactory<SignalGenerator>>;
  filters: Record<string, ComponentFactory<Filter>>;
  risk: Record<string, ComponentFactory<PositionSizer>>;
  exits: Record<string, ComponentFactory<ExitCondition>>;
}

const registry: ComponentRegistry = {
  signals: {
    'emaCrossover': (params) => new EMACrossoverSignal(params),
    'breakout': (params) => new BreakoutSignal(params),
    'rsiReversal': (params) => new RSIReversalSignal(params),
    'macdCrossover': (params) => new MACDCrossoverSignal(params),
  },
  filters: {
    'adxTrend': (params) => new ADXTrendFilter(params),
    'rsiExtreme': (params) => new RSIExtremeFilter(params),
    'volatility': (params) => new VolatilityFilter(params),
    'timeOfDay': (params) => new TimeOfDayFilter(params),
  },
  risk: {
    'fixed': (params) => new FixedPositionSizer(params),
    'atrBased': (params) => new ATRPositionSizer(params),
    'percentEquity': (params) => new PercentEquitySizer(params),
  },
  exits: {
    'stopLoss': () => new StopLossExit(),              // checks position.stopLoss from sizer
    'trailingStop': (params) => new TrailingStopExit(params),
    'takeProfit': (params) => new TakeProfitExit(params),
    'timeBased': (params) => new TimeBasedExit(params),
    'maxDrawdown': (params) => new MaxDrawdownExit(params),
  }
};

// Register new component
function registerComponent<T extends keyof ComponentRegistry>(
  layer: T,
  name: string,
  factory: ComponentRegistry[T][string]
): void {
  registry[layer][name] = factory;
}
```

## Configuration Structure

### Strategy Config Interface

```typescript
interface ComponentConfig {
  type: string;
  params: Record<string, any>;
}

interface StrategyConfig {
  symbol: string;
  name: string;
  description?: string;
  signals: ComponentConfig[];
  filters: ComponentConfig[];
  risk: ComponentConfig;
  exits: ComponentConfig[];
  settings?: {
    timeframe?: string;
    maxOpenPositions?: number;
    cooldownCandles?: number;
  };
}
```

### Example: ETH Trend Following

```json
{
  "symbol": "ETHUSDT",
  "name": "ETH Trend Following",
  "description": "EMA crossover with ADX filter and trailing stop",
  "signals": [
    {
      "type": "emaCrossover",
      "params": {
        "fastPeriod": 20,
        "slowPeriod": 50
      }
    }
  ],
  "filters": [
    {
      "type": "adxTrend",
      "params": {
        "period": 14,
        "threshold": 25,
        "timeframe": 60
      }
    },
    {
      "type": "rsiExtreme",
      "params": {
        "period": 14,
        "overbought": 75,
        "oversold": 25,
        "blockEntry": true
      }
    }
  ],
  "risk": {
    "type": "atrBased",
    "params": {
      "riskPercent": 2,
      "atrPeriod": 14,
      "stopMultiplier": 2.5
    }
  },
  "exits": [
    {
      "type": "stopLoss",
      "params": {}
    },
    {
      "type": "trailingStop",
      "params": {
        "atrMultiplier": 2.0,
        "activateAfterPercent": 1.0
      }
    }
  ],
  "settings": {
    "timeframe": "1m",
    "maxOpenPositions": 1,
    "cooldownCandles": 5
  }
}
```

### Example: BTC Breakout

```json
{
  "symbol": "BTCUSDT",
  "name": "BTC Breakout",
  "description": "Donchian channel breakout with volatility filter",
  "signals": [
    {
      "type": "breakout",
      "params": {
        "period": 20,
        "confirmCandles": 2
      }
    }
  ],
  "filters": [
    {
      "type": "adxTrend",
      "params": {
        "period": 14,
        "threshold": 20,
        "timeframe": 60
      }
    },
    {
      "type": "volatility",
      "params": {
        "atrPeriod": 14,
        "minAtrPercent": 0.5,
        "maxAtrPercent": 3.0
      }
    }
  ],
  "risk": {
    "type": "atrBased",
    "params": {
      "riskPercent": 1.5,
      "atrPeriod": 14,
      "stopMultiplier": 3.0
    }
  },
  "exits": [
    {
      "type": "stopLoss",
      "params": {}
    },
    {
      "type": "trailingStop",
      "params": {
        "atrMultiplier": 2.5
      }
    },
    {
      "type": "takeProfit",
      "params": {
        "rMultiple": 3
      }
    }
  ]
}
```

### Example: SOL Mean Reversion

```json
{
  "symbol": "SOLUSDT",
  "name": "SOL Mean Reversion",
  "description": "RSI reversal in ranging markets",
  "signals": [
    {
      "type": "rsiReversal",
      "params": {
        "period": 14,
        "oversoldLevel": 30,
        "overboughtLevel": 70
      }
    }
  ],
  "filters": [
    {
      "type": "adxTrend",
      "params": {
        "period": 14,
        "threshold": 25,
        "inverse": true
      }
    }
  ],
  "risk": {
    "type": "fixed",
    "params": {
      "positionSize": 1000,
      "stopPercent": 2
    }
  },
  "exits": [
    {
      "type": "stopLoss",
      "params": {}
    },
    {
      "type": "takeProfit",
      "params": {
        "percent": 2
      }
    },
    {
      "type": "timeBased",
      "params": {
        "maxHoldingCandles": 100
      }
    }
  ]
}
```

## Strategy Composer

```typescript
class ComposableStrategy {
  private config: StrategyConfig;
  private signals: SignalGenerator[];
  private filters: Filter[];
  private positionSizer: PositionSizer;
  private exits: ExitCondition[];
  private state: StrategyState;

  constructor(
    signals: SignalGenerator[],
    filters: Filter[],
    positionSizer: PositionSizer,
    exits: ExitCondition[],
    config: StrategyConfig
  ) {
    this.signals = signals;
    this.filters = filters;
    this.positionSizer = positionSizer;
    this.exits = exits;
    this.config = config;
    this.state = {
      position: null,
      indicators: new Map(),
      lastSignal: null,
    };
  }

  static fromConfig(config: StrategyConfig): ComposableStrategy {
    const signals = config.signals.map(s => {
      const factory = registry.signals[s.type];
      if (!factory) throw new Error(`Unknown signal type: ${s.type}`);
      return factory(s.params);
    });

    const filters = config.filters.map(f => {
      const factory = registry.filters[f.type];
      if (!factory) throw new Error(`Unknown filter type: ${f.type}`);
      return factory(f.params);
    });

    const riskFactory = registry.risk[config.risk.type];
    if (!riskFactory) throw new Error(`Unknown risk type: ${config.risk.type}`);
    const positionSizer = riskFactory(config.risk.params);

    const exits = config.exits.map(e => {
      const factory = registry.exits[e.type];
      if (!factory) throw new Error(`Unknown exit type: ${e.type}`);
      return factory(e.params);
    });

    return new ComposableStrategy(signals, filters, positionSizer, exits, config);
  }

  processCandle(candle: Candle): TradeAction | null {
    // 1. Update all component internal states
    this.filters.forEach(f => f.processCandle(candle));
    this.exits.forEach(e => e.processCandle(candle));

    // 2. Collect all signals from all signal generators
    const signals: Signal[] = [];
    for (const signalGen of this.signals) {
      const signal = signalGen.processCandle(candle, this.state);
      if (signal) signals.push(signal);
    }

    // 3. If in position - check for exits
    if (this.state.position) {
      // 3a. Check EXIT signals first (strategy-based exits)
      const closeSignal = signals.find(s =>
        s.action === 'CLOSE' && s.direction === this.state.position!.direction
      );
      if (closeSignal) {
        return {
          type: 'EXIT',
          reason: `Signal: ${closeSignal.source}`,
          price: closeSignal.price,
          timestamp: closeSignal.timestamp,
        };
      }

      // 3b. Check special exit conditions (risk management)
      for (const exit of this.exits) {
        const exitSignal = exit.shouldExit(this.state.position, candle, this.state);
        if (exitSignal) {
          return {
            type: 'EXIT',
            reason: exitSignal.reason,
            price: exitSignal.price,
            timestamp: exitSignal.timestamp,
          };
        }
      }

      // In position, no exit triggered
      return null;
    }

    // 4. Not in position - check for OPEN signals
    const openSignal = signals.find(s => s.action === 'OPEN');
    if (!openSignal) return null;

    // 5. Apply all filters (ALL must pass)
    const passesAllFilters = this.filters.every(f =>
      f.shouldAllow(openSignal, candle, this.state)
    );
    if (!passesAllFilters) return null;

    // 6. Calculate position size
    const size = this.positionSizer.calculateSize(openSignal, candle, this.state);

    return {
      type: 'ENTRY',
      direction: openSignal.direction,
      price: openSignal.price,
      quantity: size.quantity,
      stopLoss: size.stopLoss,
      riskAmount: size.riskAmount,
      signalSource: openSignal.source,
      timestamp: openSignal.timestamp,
    };
  }

  reset(): void {
    this.signals.forEach(s => s.reset());
    this.filters.forEach(f => f.reset());
    this.exits.forEach(e => e.reset());
    this.state = {
      position: null,
      indicators: new Map(),
      lastSignal: null,
    };
  }

  getConfig(): StrategyConfig {
    return this.config;
  }
}
```

## Directory Structure

```
src/backtest/
├── components/
│   ├── signals/
│   │   ├── index.ts                    # exports + signal registry
│   │   ├── signal.interface.ts         # SignalGenerator interface
│   │   ├── ema-crossover.signal.ts
│   │   ├── breakout.signal.ts
│   │   ├── rsi-reversal.signal.ts
│   │   └── macd-crossover.signal.ts
│   ├── filters/
│   │   ├── index.ts                    # exports + filter registry
│   │   ├── filter.interface.ts         # Filter interface
│   │   ├── adx-trend.filter.ts
│   │   ├── rsi-extreme.filter.ts
│   │   ├── volatility.filter.ts
│   │   └── time-of-day.filter.ts
│   ├── risk/
│   │   ├── index.ts                    # exports + risk registry
│   │   ├── position-sizer.interface.ts # PositionSizer interface
│   │   ├── fixed-size.sizer.ts
│   │   ├── atr-based.sizer.ts
│   │   └── percent-equity.sizer.ts
│   └── exits/
│       ├── index.ts                    # exports + exit registry
│       ├── exit.interface.ts           # ExitCondition interface
│       ├── stop-loss.exit.ts           # checks initial stop from position sizer
│       ├── trailing-stop.exit.ts
│       ├── take-profit.exit.ts
│       ├── time-based.exit.ts
│       └── max-drawdown.exit.ts
├── core/
│   ├── interfaces.ts                   # shared types (Signal, Position, etc.)
│   ├── registry.ts                     # unified component registry
│   ├── strategy-composer.ts            # ComposableStrategy class
│   └── strategy-loader.ts              # loads configs, builds strategies
├── config/
│   └── strategies/
│       ├── ETHUSDT.json
│       ├── BTCUSDT.json
│       ├── SOLUSDT.json
│       └── index.ts                    # loads all configs
├── indicators/                         # low-level indicators (used by components)
│   ├── index.ts
│   ├── ema.ts
│   ├── adx.ts
│   ├── atr.ts
│   └── rsi.ts
├── backtest-engine.ts                  # orchestrates backtesting
└── run-backtest.ts                     # CLI entry point
```

## Example Component Implementations

### EMA Crossover Signal

```typescript
import { SignalGenerator, Signal, StrategyState } from '../core/interfaces';
import { EMAIndicator } from '../indicators';
import { Candle } from '../types';

interface EMACrossoverParams {
  fastPeriod: number;
  slowPeriod: number;
}

export class EMACrossoverSignal implements SignalGenerator {
  name = 'emaCrossover';
  private fastEMA: EMAIndicator;
  private slowEMA: EMAIndicator;
  private prevFast: number | null = null;
  private prevSlow: number | null = null;

  constructor(params: EMACrossoverParams) {
    this.fastEMA = new EMAIndicator(params.fastPeriod);
    this.slowEMA = new EMAIndicator(params.slowPeriod);
  }

  processCandle(candle: Candle, state: StrategyState): Signal | null {
    const fast = this.fastEMA.processCandle(candle);
    const slow = this.slowEMA.processCandle(candle);

    if (fast === null || slow === null || this.prevFast === null || this.prevSlow === null) {
      this.prevFast = fast;
      this.prevSlow = slow;
      return null;
    }

    let signal: Signal | null = null;
    const hasPosition = state.position !== null;
    const positionDirection = state.position?.direction;

    // Bullish crossover
    if (this.prevFast <= this.prevSlow && fast > slow) {
      if (hasPosition && positionDirection === 'SHORT') {
        // Close SHORT position
        signal = {
          action: 'CLOSE',
          direction: 'SHORT',
          source: this.name,
          price: candle.close,
          timestamp: candle.closeTime,
        };
      } else if (!hasPosition) {
        // Open LONG position
        signal = {
          action: 'OPEN',
          direction: 'LONG',
          source: this.name,
          price: candle.close,
          timestamp: candle.closeTime,
        };
      }
    }
    // Bearish crossover
    else if (this.prevFast >= this.prevSlow && fast < slow) {
      if (hasPosition && positionDirection === 'LONG') {
        // Close LONG position
        signal = {
          action: 'CLOSE',
          direction: 'LONG',
          source: this.name,
          price: candle.close,
          timestamp: candle.closeTime,
        };
      } else if (!hasPosition) {
        // Open SHORT position
        signal = {
          action: 'OPEN',
          direction: 'SHORT',
          source: this.name,
          price: candle.close,
          timestamp: candle.closeTime,
        };
      }
    }

    this.prevFast = fast;
    this.prevSlow = slow;
    return signal;
  }

  reset(): void {
    this.fastEMA.reset();
    this.slowEMA.reset();
    this.prevFast = null;
    this.prevSlow = null;
  }
}
```

### ADX Trend Filter

```typescript
import { Filter, Signal, StrategyState } from '../core/interfaces';
import { ADXIndicator } from '../indicators';
import { CandleAggregator } from '../candle-aggregator';
import { Candle } from '../types';

interface ADXTrendParams {
  period: number;
  threshold: number;
  timeframe?: number;  // in minutes, default 60
  inverse?: boolean;   // true = only allow when NOT trending (for mean reversion)
}

export class ADXTrendFilter implements Filter {
  name = 'adxTrend';
  private adx: ADXIndicator;
  private aggregator: CandleAggregator | null;
  private threshold: number;
  private inverse: boolean;

  constructor(params: ADXTrendParams) {
    this.adx = new ADXIndicator(params.period);
    this.threshold = params.threshold;
    this.inverse = params.inverse ?? false;
    this.aggregator = params.timeframe ? new CandleAggregator(params.timeframe) : null;
  }

  processCandle(candle: Candle): void {
    if (this.aggregator) {
      const htfCandle = this.aggregator.processCandle(candle);
      if (htfCandle) {
        this.adx.processCandle(htfCandle);
      }
    } else {
      this.adx.processCandle(candle);
    }
  }

  shouldAllow(signal: Signal, candle: Candle, state: StrategyState): boolean {
    const adxValue = this.adx.getADX();
    if (adxValue === null) return false;

    const isTrending = adxValue >= this.threshold;
    return this.inverse ? !isTrending : isTrending;
  }

  reset(): void {
    this.adx.reset();
    this.aggregator?.reset();
  }
}
```

### ATR-Based Position Sizer

```typescript
import { PositionSizer, Signal, PositionSize, StrategyState } from '../core/interfaces';
import { ATRIndicator } from '../indicators';
import { Candle } from '../types';

interface ATRBasedParams {
  riskPercent: number;      // % of capital to risk per trade
  atrPeriod: number;
  stopMultiplier: number;   // stop = entry +/- (ATR * multiplier)
  capitalBase?: number;     // default 10000
}

export class ATRBasedSizer implements PositionSizer {
  name = 'atrBased';
  private atr: ATRIndicator;
  private riskPercent: number;
  private stopMultiplier: number;
  private capitalBase: number;

  constructor(params: ATRBasedParams) {
    this.atr = new ATRIndicator(params.atrPeriod);
    this.riskPercent = params.riskPercent;
    this.stopMultiplier = params.stopMultiplier;
    this.capitalBase = params.capitalBase ?? 10000;
  }

  calculateSize(signal: Signal, candle: Candle, state: StrategyState): PositionSize {
    const atrValue = this.atr.getATR();
    if (atrValue === null) {
      // Fallback to fixed size if ATR not ready
      return {
        quantity: 1000 / signal.price,
        stopLoss: signal.type === 'LONG'
          ? signal.price * 0.98
          : signal.price * 1.02,
        riskAmount: 20,
      };
    }

    const stopDistance = atrValue * this.stopMultiplier;
    const riskAmount = this.capitalBase * (this.riskPercent / 100);
    const quantity = riskAmount / stopDistance;

    const stopLoss = signal.type === 'LONG'
      ? signal.price - stopDistance
      : signal.price + stopDistance;

    return {
      quantity,
      stopLoss,
      riskAmount,
    };
  }
}
```

### Trailing Stop Exit

```typescript
import { ExitCondition, ExitSignal, StrategyState, Position } from '../core/interfaces';
import { ATRIndicator } from '../indicators';
import { Candle } from '../types';

interface TrailingStopParams {
  atrMultiplier: number;
  activateAfterPercent?: number;  // only start trailing after X% profit
}

export class TrailingStopExit implements ExitCondition {
  name = 'trailingStop';
  private atr: ATRIndicator;
  private multiplier: number;
  private activateAfter: number;
  private highestPrice: number = 0;
  private lowestPrice: number = Infinity;

  constructor(params: TrailingStopParams) {
    this.atr = new ATRIndicator(14);
    this.multiplier = params.atrMultiplier;
    this.activateAfter = params.activateAfterPercent ?? 0;
  }

  processCandle(candle: Candle): void {
    this.atr.processCandle(candle);
    this.highestPrice = Math.max(this.highestPrice, candle.high);
    this.lowestPrice = Math.min(this.lowestPrice, candle.low);
  }

  shouldExit(position: Position, candle: Candle, state: StrategyState): ExitSignal | null {
    const atrValue = this.atr.getATR();
    if (atrValue === null) return null;

    const trailDistance = atrValue * this.multiplier;
    const pnlPercent = position.direction === 'LONG'
      ? (candle.close - position.entryPrice) / position.entryPrice * 100
      : (position.entryPrice - candle.close) / position.entryPrice * 100;

    // Check if trailing should be active
    if (pnlPercent < this.activateAfter) return null;

    if (position.direction === 'LONG') {
      const trailStop = this.highestPrice - trailDistance;
      if (candle.low <= trailStop) {
        return {
          reason: 'Trailing stop hit',
          price: trailStop,
          timestamp: candle.closeTime,
        };
      }
    } else {
      const trailStop = this.lowestPrice + trailDistance;
      if (candle.high >= trailStop) {
        return {
          reason: 'Trailing stop hit',
          price: trailStop,
          timestamp: candle.closeTime,
        };
      }
    }

    return null;
  }

  reset(): void {
    this.atr.reset();
    this.highestPrice = 0;
    this.lowestPrice = Infinity;
  }
}
```

## Usage Examples

### Running Backtest for Single Pair

```typescript
import { StrategyLoader } from './core/strategy-loader';
import { BacktestEngine } from './backtest-engine';

async function runBacktest(symbol: string) {
  // Load strategy config
  const config = StrategyLoader.loadConfig(`./config/strategies/${symbol}.json`);

  // Build strategy from config
  const strategy = ComposableStrategy.fromConfig(config);

  // Run backtest
  const engine = new BacktestEngine(strategy);
  const result = await engine.run(symbol, startDate, endDate);

  // Export results
  await engine.exportCSV(result);
  await engine.exportChart(result);
}
```

### Running Multiple Pairs

```typescript
async function runAllBacktests() {
  const configs = StrategyLoader.loadAllConfigs('./config/strategies/');

  for (const config of configs) {
    console.log(`Running backtest for ${config.symbol}...`);
    const strategy = ComposableStrategy.fromConfig(config);
    const engine = new BacktestEngine(strategy);
    const result = await engine.run(config.symbol, startDate, endDate);
    await engine.exportResults(result);
  }
}
```

### Adding New Component

```typescript
// 1. Create the component
// src/backtest/components/signals/bollinger-squeeze.signal.ts
export class BollingerSqueezeSignal implements SignalGenerator {
  name = 'bollingerSqueeze';
  // ... implementation
}

// 2. Register in index.ts
// src/backtest/components/signals/index.ts
import { BollingerSqueezeSignal } from './bollinger-squeeze.signal';

export const signalRegistry = {
  // ... existing
  'bollingerSqueeze': (params) => new BollingerSqueezeSignal(params),
};

// 3. Use in config
// config/strategies/AVAXUSDT.json
{
  "signals": [
    { "type": "bollingerSqueeze", "params": { "period": 20, "stdDev": 2 } }
  ]
}
```

## Benefits Summary

| Benefit | Description |
|---------|-------------|
| **Composable** | Mix and match any combination of signals, filters, risk, and exits |
| **Configurable** | JSON configs per pair, no code changes for new strategies |
| **Extensible** | Add new component → register → use in config |
| **Testable** | Each component can be unit tested in isolation |
| **Version Control** | Configs are just JSON files, easy to track changes |
| **A/B Testing** | Run same pair with different configs to compare |
| **Type Safe** | Full TypeScript support with interfaces |
| **Memory Efficient** | Components use existing optimized indicators |
| **No Duplication** | Signals handle both OPEN and CLOSE - no duplicate exit components |
| **Clear Separation** | Signals = strategy logic, Exits = risk management only |

## Implementation Priority

1. **Phase 1**: Core interfaces and registry system
2. **Phase 2**: Refactor existing EMA crossover as first signal component
3. **Phase 3**: Add ADX filter, trailing stop exit, ATR position sizer
4. **Phase 4**: Create first config file, test full pipeline
5. **Phase 5**: Add more components as needed

---

*Document created: Composable strategy architecture design for multi-pair trading system*

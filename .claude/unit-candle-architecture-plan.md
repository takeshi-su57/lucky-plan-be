# Unit-Level Candle Architecture Refactoring Plan

## Overview
Refactor the backtest system to accept only unit-level candles (1-minute) and have each component manage its own timeframe aggregation with explicit handling of incomplete candles.

## Core Changes

### 1. Candle Interface Update
**File:** `src/backtest/types.ts`

```typescript
export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  isCompleted: boolean;  // NEW: Required field
}
```

### 2. CandleAggregator Updates
**File:** `src/backtest/candle-aggregator.ts`

- `processCandle()` returns candle with `isCompleted: true`
- `getCurrentCandle()` returns candle with `isCompleted: false`
- New method: `processWithCurrent(candle)` - returns both completed HTF candle (if any) AND current incomplete candle

### 3. Component Parameter Updates
All components that use indicators need two new required params:
- `timeframe: number` - timeframe in minutes (required, no default)
- `useCurrentCandle: boolean` - whether to use incomplete candles (required, no default)

### 4. Indicator Pending Buffer Pattern
Each indicator needs to support incomplete candle processing:

```typescript
interface IndicatorWithPending<T> {
  // Existing
  processCandle(candle: Candle): T | null;
  reset(): void;

  // New for pending buffer
  processIncompleteCandle(candle: Candle): T | null;  // Calculate without committing
  commitPendingState(): void;  // Finalize pending state
  discardPendingState(): void; // Revert to last committed state
}
```

## Files to Modify

### Phase 1: Core Types & Aggregator
1. `src/backtest/types.ts` - Add `isCompleted: boolean` to Candle
2. `src/backtest/candle-aggregator.ts` - Set `isCompleted` on output candles

### Phase 2: Indicators (Pending Buffer Support)
Priority order based on complexity:

**Easy (Circular Buffer):**
3. `src/backtest/indicators/sma.ts`
4. `src/backtest/indicators/bollinger.ts`
5. `src/backtest/indicators/donchian.ts`

**Medium (State Tracking):**
6. `src/backtest/indicators/ema.ts`
7. `src/backtest/indicators/atr.ts`
8. `src/backtest/indicators/rsi.ts`

**Complex (Multi-stage):**
9. `src/backtest/indicators/macd.ts`
10. `src/backtest/indicators/stochastic.ts`
11. `src/backtest/indicators/adx.ts`

### Phase 3: Components (Add timeframe + useCurrentCandle params)

**Filters:**
12. `src/backtest/components/filters/adx-trend.filter.ts` - Already has timeframe, add useCurrentCandle
13. `src/backtest/components/filters/htf-ema-bias.filter.ts` - Rename htfMinutes to timeframe, add useCurrentCandle
14. `src/backtest/components/filters/bollinger-volatility.filter.ts` - Add both params
15. `src/backtest/components/filters/stochastic.filter.ts` - Add both params
16. `src/backtest/components/filters/rsi-extreme.filter.ts` - Add both params
17. `src/backtest/components/filters/ema-slope.filter.ts` - Add both params
18. `src/backtest/components/filters/ema-stack.filter.ts` - Add both params
19. `src/backtest/components/filters/ma-position.filter.ts` - Add both params

**Signals:**
20. `src/backtest/components/signals/ema-crossover.signal.ts` - Add both params
21. `src/backtest/components/signals/sma-crossover.signal.ts` - Add both params
22. `src/backtest/components/signals/macd-crossover.signal.ts` - Add both params
23. `src/backtest/components/signals/rsi-reversal.signal.ts` - Add both params
24. `src/backtest/components/signals/bollinger-bounce.signal.ts` - Add both params
25. `src/backtest/components/signals/donchian-breakout.signal.ts` - Add both params

**Exits:**
26. `src/backtest/components/exits/stop-loss.exit.ts` - Add both params
27. `src/backtest/components/exits/trailing-stop.exit.ts` - Add both params
28. `src/backtest/components/exits/take-profit.exit.ts` - Add both params
29. `src/backtest/components/exits/time-based.exit.ts` - Add both params

**Position Sizers:**
30. `src/backtest/components/risk/fixed-size.sizer.ts` - Add both params
31. `src/backtest/components/risk/atr-based.sizer.ts` - Add both params

### Phase 4: Data Sources
32. `src/backtest/binance-fetcher.ts` - Set `isCompleted: true` on all fetched candles

### Phase 5: Strategy Config Updates
33. Update all JSON configs in `src/backtest/config/strategies/` to include new required params

## Pending Buffer Implementation Pattern

For each indicator type:

### Circular Buffer Indicators (SMA, Bollinger, Donchian)
```typescript
class SMAIndicator {
  private prices: number[] = [];
  private sum: number = 0;
  private index: number = 0;

  // Pending state
  private committedSum: number = 0;
  private committedIndex: number = 0;
  private hasPending: boolean = false;

  processCandle(candle: Candle): number | null {
    if (candle.isCompleted) {
      this.commitPendingState();
      return this.processComplete(candle);
    } else {
      return this.processIncomplete(candle);
    }
  }

  private processIncomplete(candle: Candle): number | null {
    if (this.hasPending) {
      // Revert to committed state
      this.sum = this.committedSum;
      this.index = this.committedIndex;
    } else {
      // Save committed state
      this.committedSum = this.sum;
      this.committedIndex = this.index;
      this.hasPending = true;
    }
    // Calculate with pending candle (doesn't commit)
    return this.calculate(candle);
  }

  private commitPendingState(): void {
    this.hasPending = false;
  }
}
```

### Lightweight Indicators (EMA, RSI, ATR)
```typescript
class EMAIndicator {
  private ema: number | null = null;

  // Pending state
  private committedEma: number | null = null;
  private hasPending: boolean = false;

  processCandle(candle: Candle): number | null {
    if (candle.isCompleted) {
      this.commitPendingState();
      return this.processComplete(candle);
    } else {
      return this.processIncomplete(candle);
    }
  }

  private processIncomplete(candle: Candle): number | null {
    if (this.hasPending) {
      this.ema = this.committedEma;  // Revert
    } else {
      this.committedEma = this.ema;  // Save
      this.hasPending = true;
    }
    // Calculate without committing
    return this.calculateEma(candle.close);
  }
}
```

## Component processCandle Flow

```typescript
class ADXTrendFilter implements Filter {
  private aggregator: CandleAggregator;
  private adx: ADXIndicator;
  private useCurrentCandle: boolean;

  processCandle(candle: Candle): void {
    const completed = this.aggregator.processCandle(candle);

    if (completed) {
      // Always process completed candles
      this.adx.processCandle({ ...completed, isCompleted: true });
    }

    if (this.useCurrentCandle) {
      // Also process current incomplete candle
      const current = this.aggregator.getCurrentCandle();
      if (current) {
        this.adx.processCandle({ ...current, isCompleted: false });
      }
    }
  }
}
```

## Design Decisions Made

1. **All components get `timeframe` + `useCurrentCandle` params** - including exits and position sizers
2. **No defaults** - users must explicitly set both params for every component
3. **Consistent architecture** - every component is self-contained with its own timeframe configuration

## Verification Plan

1. Run existing tests to ensure no regressions
2. Create a test strategy with multiple timeframes to verify:
   - Signal on 5m timeframe
   - Filter on 15m timeframe
   - Exit on 1m timeframe
3. Verify incomplete candle handling with a simple test case
4. Run backtest with `useCurrentCandle: true` vs `false` and compare results

## Implementation Order Summary

| Step | What | Files | Impact |
|------|------|-------|--------|
| 1 | Add `isCompleted` to Candle | types.ts | Breaking - all candle creation needs update |
| 2 | Update CandleAggregator | candle-aggregator.ts | Sets isCompleted on outputs |
| 3 | Update binance-fetcher | binance-fetcher.ts | Sets isCompleted: true |
| 4 | Add pending buffer to indicators | indicators/*.ts | Core change - enables incomplete candle support |
| 5 | Update all components | components/**/*.ts | Add timeframe + useCurrentCandle params |
| 6 | Update strategy configs | config/strategies/*.json | Add new required params |
| 7 | Update registry/interfaces | core/*.ts | Ensure interfaces match new patterns |

## Key Breaking Changes

1. **Candle interface** - `isCompleted` is now required
2. **All component params** - `timeframe` and `useCurrentCandle` are required (no defaults)
3. **Strategy configs** - must include new params for every component

## Migration Strategy

For existing strategies, set:
- `timeframe: 1` (use 1-minute candles, same as before)
- `useCurrentCandle: false` (only use completed candles, same behavior as before)

This ensures backwards compatibility while enabling the new architecture.

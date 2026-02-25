# Signal Refactor Plan

## Problem Statement

Current signal design mixes two responsibilities:
1. Detecting entry opportunities
2. Deciding whether to OPEN or CLOSE positions

This leads to:
- Signals needing to understand position state
- Complex logic split between signals and composer
- Position flip (e.g., EMA crossover) not working correctly

## New Design

### Core Principle
**Signals only detect entry moments. Composer handles all position logic.**

### Signal Output (Before)
```typescript
interface Signal {
  action: 'OPEN' | 'CLOSE';  // Signal decides this
  direction: 'LONG' | 'SHORT';
  price: number;
  timestamp: number;
  source: string;
}
```

### Signal Output (After)
```typescript
interface Signal {
  direction: 'LONG' | 'SHORT';  // Just the direction
  price: number;
  timestamp: number;
  source: string;
}
```

### Composer Logic (New)
```
When signal received:
  - No position → open new position
  - Position same direction → ignore (already in)
  - Position opposite direction → close current, open new (flip)

When no signal:
  - Check exit conditions (SL, trailing, etc.)
  - Exit triggered → close position only (no new entry)
```

---

## Files to Modify

### 1. Interfaces
**File:** `src/backtest/core/interfaces.ts`

Changes:
- Remove `action` field from `Signal` interface
- Update JSDoc comments

### 2. Signal Implementations
**Directory:** `src/backtest/components/signals/`

Files to modify:
- `ema-crossover.signal.ts`
- `bollinger-bounce.signal.ts`
- Any other signal files

Changes per file:
- Remove `action: 'OPEN' | 'CLOSE'` logic
- Simply return `{ direction, price, timestamp, source }` when signal detected
- Remove position-aware logic from signals

### 3. Strategy Composer
**File:** `src/backtest/core/strategy-composer.ts`

Changes to `processCandle()` method:

**Before (current logic):**
```typescript
processCandle(candle: Candle): TradeAction | null {
  // ... update components ...

  const signal = this.signal.processCandle(candle, this.state);

  // If in position - check for exits
  if (this.state.position) {
    // Check for CLOSE signal
    if (signal?.action === 'CLOSE' && signal.direction === position.direction) {
      return EXIT;
    }
    // Check exit conditions
    // ...
    return null;  // <-- Problem: never checks for opposite OPEN
  }

  // Not in position - check for OPEN
  if (signal?.action === 'OPEN') {
    // Apply filters, calculate size
    return ENTRY;
  }
}
```

**After (new logic):**
```typescript
processCandle(candle: Candle): TradeAction | null {
  // ... update components ...

  const signal = this.signal.processCandle(candle, this.state);

  // If in position
  if (this.state.position) {
    // Check if signal wants opposite direction (position flip)
    if (signal && signal.direction !== this.state.position.direction) {
      // Apply filters for the new direction
      if (this.passesFilters(signal, candle)) {
        const size = this.calculateSize(signal, candle);
        return {
          type: 'ENTRY',  // Engine handles close + open
          direction: signal.direction,
          price: signal.price,
          quantity: size.quantity,
          // ...
        };
      }
    }

    // Check exit conditions (SL, trailing, etc.)
    for (const exit of this.exits) {
      const exitSignal = exit.shouldExit(position, candle, state);
      if (exitSignal) {
        return { type: 'EXIT', ... };
      }
    }

    // Same direction signal or no signal - stay in position
    return null;
  }

  // Not in position - check for new entry
  if (signal) {
    if (this.passesFilters(signal, candle)) {
      const size = this.calculateSize(signal, candle);
      return { type: 'ENTRY', direction: signal.direction, ... };
    }
  }

  return null;
}
```

### 4. Backtest Engine
**File:** `src/backtest/composable-backtest-engine.ts`

No changes needed. The engine already handles position flip correctly:
```typescript
if (action.type === 'ENTRY') {
  if (this.currentPosition) {
    if (this.currentPosition.direction !== action.direction) {
      this.closePosition(...);  // Close existing
    } else {
      return;  // Same direction, skip
    }
  }
  this.openPosition(action);  // Open new
}
```

---

## Implementation Steps

### Step 1: Update Interfaces
1. Edit `src/backtest/core/interfaces.ts`
2. Remove `action` from `Signal` interface
3. Update related type definitions

### Step 2: Update Signal Implementations
For each signal file:
1. Remove `action` field from return objects
2. Simplify logic - just detect direction
3. Remove any position-aware code

### Step 3: Update Strategy Composer
1. Rewrite `processCandle()` with new logic
2. Extract filter/size logic into helper methods for reuse
3. Handle position flip case

### Step 4: Test
1. Run existing backtest with EMA crossover strategy
2. Verify position flips work correctly
3. Verify exits (SL, trailing) still work independently
4. Compare results before/after refactor

---

## Test Cases

### Case 1: No Position → Signal
- Signal: LONG
- Expected: Open LONG position

### Case 2: Same Direction Signal
- Position: LONG
- Signal: LONG
- Expected: Ignore (already in LONG)

### Case 3: Opposite Direction Signal (Position Flip)
- Position: LONG
- Signal: SHORT
- Expected: Close LONG, Open SHORT (on same candle)

### Case 4: Exit Condition Triggered
- Position: LONG
- Signal: none
- Stop Loss: triggered
- Expected: Close LONG only (no new position)

### Case 5: Exit + Opposite Signal Same Candle
- Position: LONG
- Signal: SHORT
- Stop Loss: also triggered
- Expected: Close LONG, Open SHORT (signal takes priority over exit)

---

## Rollback Plan

If issues arise:
1. All changes are in git, can revert
2. Keep old signal interface as deprecated for transition
3. Add feature flag to switch between old/new logic

---

## Estimated Scope

| Area | Files | Complexity |
|------|-------|------------|
| Interfaces | 1 | Low |
| Signals | 2-3 | Low |
| Composer | 1 | Medium |
| Engine | 0 | None |
| Tests | New | Medium |

Total: ~4-5 files to modify

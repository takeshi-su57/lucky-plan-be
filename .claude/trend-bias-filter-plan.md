# Trend Bias Filter Implementation Plan

## Research Summary

### Core Principle
**Bias = Permission filter, not prediction**

Trend bias answers one question only:
> In which direction am I allowed to trade right now?

It does NOT:
- Predict reversals
- Guarantee a trade will work
- Mean price will keep going

It simply **removes bad trades**.

### Why 1-Minute Bots Need Bias
- Price flips direction constantly
- Most candles are noise
- Indicators lie more often than they tell the truth

Without bias:
- You trade both directions in chop
- Losses cluster
- ATR stops get hit repeatedly

**Trend bias is your noise gate.**

---

## Three Classes of Trend Bias

### Class A: Higher-Timeframe Structure (Strongest)

**Principle:** Use a slower timeframe to define direction, trade entries on 1m.

**Why it works:**
- Trends exist on multiple scales
- 1m noise resolves inside 5m/15m structure

**Examples:**
- Only LONG if 5m close > EMA(50)
- Only SHORT if 15m EMA slope < 0

This alone filters a massive amount of chop.

### Class B: Trend Slope (Directional Strength)

**Principle:** Direction without slope = chop.

**How:**
- EMA slope
- Linear regression slope
- Difference between MA values

**Example:**
```
bias_long = EMA(50)[0] > EMA(50)[n]
```
Or:
```
EMA(20) > EMA(50) AND EMA(50) > EMA(200)
```

**Slope matters more than crossover events.**

### Class C: Position Relative to Value

**Principle:** Price above value → bullish bias, Price below value → bearish bias

**Example:**
- Price above MA → long-only
- Price below MA → short-only

This works surprisingly well on crypto perps.

---

## What NOT to Use for Bias

Avoid these as **primary** bias filters:
- RSI overbought/oversold
- MACD histogram color
- Single MA cross on 1m
- Candle patterns

**They react too fast and flip constantly.**

---

## Practical Bias Models

### Model 1: HTF EMA Bias (Simple & Strong)

**Timeframes:**
- Bias: 5m
- Entry: 1m

**Rules:**
- LONG only if 5m close > EMA(50)
- SHORT only if 5m close < EMA(50)

**This alone improves most bots.**

### Model 2: EMA Stack + Slope (Trend Quality)

**Rules:**
- EMA(20) > EMA(50) > EMA(200)
- EMA(50) slope > 0

**This avoids weak trends.**

---

## Critical Design Rules

### Bias Must Be Slow
Bias should:
- Change infrequently
- Survive pullbacks
- Lag intentionally

> If your bias flips more than a few times per hour on 1m → it's not a bias, it's noise.

### How Bias Interacts with Stops
Bias reduces:
- Countertrend stop-outs
- ATR compression losses

**ATR stops work best with bias, not alone.**

### Common Bias Mistakes
1. Using the same timeframe for bias and entry
2. Letting bias flip mid-trade
3. Over-filtering (bias becomes too strict)
4. Trying to predict reversals
5. Optimizing bias parameters aggressively

**Bias should be robust, not precise.**

### One Key Design Rule
> **Bias defines permission, not precision.**
>
> Entries do the timing. Bias decides if you're allowed to act.

---

## Filter Classification

### Current Filters (Confirmation/Reactive)
These are useful but serve a different purpose than bias:

| Filter | Purpose | Issue for Bias |
|--------|---------|----------------|
| `adx-trend` | Trend strength | Good for confirmation |
| `rsi-extreme` | Overbought/oversold | Too reactive |
| `stochastic` | Momentum | Too reactive |
| `bollinger-vol` | Volatility regime | Not directional |

### New Bias Filters to Implement

| Filter | Class | Purpose |
|--------|-------|---------|
| `ma-position` | C | Price relative to MA |
| `ema-slope` | B | EMA momentum/direction |
| `ema-stack` | B | EMA alignment quality |
| `htf-ema-bias` | A | Higher timeframe structure |

---

## Implementation Specifications

### 1. `ma-position.filter.ts` (Priority: 1)

**Purpose:** Simple bias based on price position relative to MA

**Logic:**
- LONG only if `close > MA(period)`
- SHORT only if `close < MA(period)`

**Params:**
```typescript
interface MAPositionParams {
  period: number;      // MA period (default: 50)
  maType: 'EMA' | 'SMA'; // MA type (default: 'EMA')
}
```

**Complexity:** Low

---

### 2. `ema-slope.filter.ts` (Priority: 2)

**Purpose:** Block trades when EMA is flat or against direction

**Logic:**
- Calculate EMA slope over N periods: `slope = (EMA[0] - EMA[n]) / n`
- LONG only if `slope > minSlope`
- SHORT only if `slope < -minSlope`

**Params:**
```typescript
interface EMASlopeParams {
  period: number;       // EMA period (default: 50)
  slopePeriod: number;  // Bars to measure slope (default: 10)
  minSlope: number;     // Min slope threshold (default: 0.0001)
}
```

**Complexity:** Low

---

### 3. `ema-stack.filter.ts` (Priority: 3)

**Purpose:** Only trade when EMAs are properly aligned

**Logic:**
- LONG only if `EMA(fast) > EMA(mid) > EMA(slow)`
- SHORT only if `EMA(fast) < EMA(mid) < EMA(slow)`

**Params:**
```typescript
interface EMAStackParams {
  fastPeriod: number;  // Fast EMA (default: 20)
  midPeriod: number;   // Mid EMA (default: 50)
  slowPeriod: number;  // Slow EMA (default: 200)
}
```

**Complexity:** Low

---

### 4. `htf-ema-bias.filter.ts` (Priority: 4)

**Purpose:** Use higher timeframe EMA for direction permission

**Logic:**
- Aggregate 1m candles to HTF internally (using CandleAggregator)
- Calculate EMA on HTF candles
- LONG only if `HTF close > HTF EMA`
- SHORT only if `HTF close < HTF EMA`

**Params:**
```typescript
interface HTFEMABiasParams {
  htfMinutes: number;  // HTF in minutes: 5, 15, 60 (default: 5)
  period: number;      // EMA period on HTF (default: 50)
}
```

**Architecture:**
```
Filter receives 1m candles
  ↓
Uses CandleAggregator internally to build HTF candles
  ↓
Calculates EMA on HTF candles
  ↓
Returns bias decision
```

**Complexity:** Medium (requires internal aggregation)

---

## Example Strategy Compositions

### Conservative Trend Following
```json
{
  "signal": { "type": "emaCrossover", "params": { "fastPeriod": 9, "slowPeriod": 21 } },
  "filters": [
    { "type": "htfEmaBias", "params": { "htfMinutes": 15, "period": 50 } },
    { "type": "emaStack", "params": { "fastPeriod": 20, "midPeriod": 50, "slowPeriod": 200 } },
    { "type": "adxTrend", "params": { "period": 14, "threshold": 25 } }
  ]
}
```

### Moderate Trend Following
```json
{
  "signal": { "type": "emaCrossover", "params": { "fastPeriod": 12, "slowPeriod": 26 } },
  "filters": [
    { "type": "htfEmaBias", "params": { "htfMinutes": 5, "period": 50 } },
    { "type": "emaSlope", "params": { "period": 50, "slopePeriod": 10, "minSlope": 0.0001 } }
  ]
}
```

### Simple Bias Only
```json
{
  "signal": { "type": "emaCrossover", "params": { "fastPeriod": 9, "slowPeriod": 21 } },
  "filters": [
    { "type": "maPosition", "params": { "period": 50, "maType": "EMA" } }
  ]
}
```

---

## Testing Approach

### How to Test Bias Quality
1. Remove all entry logic
2. Enter randomly (or simple pullback)
3. Apply bias filter
4. Measure expectancy

**If bias alone improves expectancy → it's doing its job.**

### Expected Results from Good Bias
- Reduces trade count by 40-70%
- Increases expectancy
- Lowers drawdown
- Feels "boring" (fewer trades, more waiting)

---

## Implementation Order

| Step | Filter | Estimated Effort |
|------|--------|------------------|
| 1 | `ma-position.filter.ts` | Simple |
| 2 | `ema-slope.filter.ts` | Simple |
| 3 | `ema-stack.filter.ts` | Simple |
| 4 | `htf-ema-bias.filter.ts` | Medium |
| 5 | Registry updates | Simple |
| 6 | Testing & validation | Medium |

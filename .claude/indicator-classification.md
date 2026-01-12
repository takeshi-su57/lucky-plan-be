# Indicator Classification for Composable Strategy Architecture

A comprehensive classification of trend-following indicators based on their role in the composable strategy system.

## Quick Reference Table

| Indicator | Primary Use | Secondary Use | Description |
|-----------|-------------|---------------|-------------|
| **EMA/SMA Crossover** | Signal | - | Fast EMA crosses slow EMA → OPEN/CLOSE positions |
| **MACD Crossover** | Signal | Filter | MACD crosses signal line → entry/exit |
| **Donchian Channels** | Signal | - | Breakout above/below channel → OPEN/CLOSE |
| **Parabolic SAR** | Signal | Exit | Dots flip → entry or trailing exit |
| **Ichimoku Cloud** | Signal | Filter | Price vs cloud position → trend direction |
| **Vortex Indicator** | Signal | - | +VI/-VI crossover → trend reversal signal |
| **ADX** | Filter | - | Trend strength > 25 confirms trend, < 20 rejects |
| **RSI** | Filter | Signal | Overbought/oversold filter, or reversal signal |
| **Stochastic** | Filter | Signal | %K/%D levels filter entries |
| **Bollinger Bands** | Filter | Signal | Volatility filter, or mean-reversion signal |
| **CCI** | Filter | Signal | Overbought/oversold filter |
| **OBV** | Filter | - | Volume confirms trend direction |
| **Momentum** | Filter | - | Confirms trend momentum |
| **ATR** | Risk | Exit | Position sizing + Stop loss distance |

---

## Detailed Classification

### SIGNALS (Entry/Exit Logic)

Signals are responsible for determining WHEN to open and close positions. They contain the core strategy logic.

| Indicator | Signal Type | OPEN Condition | CLOSE Condition |
|-----------|-------------|----------------|-----------------|
| **EMA Crossover** | Trend | Fast > Slow → LONG | Fast < Slow → CLOSE LONG |
| **MACD Crossover** | Trend | MACD > Signal → LONG | MACD < Signal → CLOSE |
| **Donchian Breakout** | Breakout | Price > Upper Band → LONG | Price < Lower Band → CLOSE |
| **Parabolic SAR** | Trend | Dots flip below price → LONG | Dots flip above → CLOSE |
| **Ichimoku** | Trend | Price above cloud → LONG | Price below cloud → CLOSE |
| **Vortex** | Trend | +VI > -VI → LONG | -VI > +VI → CLOSE |
| **RSI Reversal** | Mean Reversion | RSI < 30 → LONG | RSI > 70 → CLOSE |
| **Bollinger Bounce** | Mean Reversion | Price < Lower Band → LONG | Price > Upper Band → CLOSE |

#### Signal Indicator Details

##### EMA/SMA Crossover
- **Type**: Trend Following
- **Logic**: When fast MA crosses above slow MA, trend is bullish. When fast crosses below slow, trend is bearish.
- **Parameters**: fastPeriod (default: 20), slowPeriod (default: 50)
- **Best For**: Trending markets with clear directional moves

##### MACD Crossover
- **Type**: Trend Following / Momentum
- **Logic**: MACD line (12 EMA - 26 EMA) crossing signal line (9 EMA of MACD)
- **Parameters**: fastPeriod (12), slowPeriod (26), signalPeriod (9)
- **Best For**: Identifying trend changes and momentum shifts
- **Additional**: Histogram shows strength of trend

##### Donchian Channel Breakout
- **Type**: Breakout
- **Logic**: Price breaking above highest high or below lowest low over N periods
- **Parameters**: period (default: 20), confirmCandles (optional)
- **Best For**: Capturing strong breakout moves, used in Turtle Trading system

##### Parabolic SAR
- **Type**: Trend Following with Built-in Exit
- **Logic**: Dots below price = uptrend, dots above = downtrend
- **Parameters**: acceleration (0.02), maximum (0.2)
- **Best For**: Trending markets, provides natural trailing stop
- **Note**: Can be used as both signal AND exit

##### Ichimoku Cloud
- **Type**: Comprehensive Trend System
- **Components**:
  - Tenkan-sen (Conversion): 9-period midpoint
  - Kijun-sen (Base): 26-period midpoint
  - Senkou Span A: Midpoint of Tenkan/Kijun, plotted 26 periods ahead
  - Senkou Span B: 52-period midpoint, plotted 26 periods ahead
  - Chikou Span: Close plotted 26 periods back
- **Logic**: Price above cloud = bullish, below = bearish
- **Best For**: Identifying trend direction, support/resistance

##### Vortex Indicator
- **Type**: Trend Reversal
- **Logic**: Compares upward (+VI) and downward (-VI) price movement
- **Parameters**: period (default: 14)
- **Best For**: Identifying trend reversals

---

### FILTERS (Confirm/Reject Signals)

Filters validate signals before allowing entry. They don't generate signals themselves but act as gatekeepers.

| Indicator | Filter Logic | Allow Entry When | Block Entry When |
|-----------|--------------|------------------|------------------|
| **ADX** | Trend Strength | ADX > 25 (strong trend) | ADX < 20 (ranging) |
| **RSI Extreme** | Overbought/Oversold | RSI 30-70 (neutral) | RSI > 70 or < 30 |
| **Bollinger Width** | Volatility | Bands expanding | Bands contracting |
| **OBV Trend** | Volume Confirm | OBV direction matches signal | OBV diverges |
| **Momentum** | Trend Confirm | Momentum > 100 for LONG | Momentum < 100 for LONG |
| **CCI** | Trend Confirm | CCI direction matches | CCI diverges |
| **Stochastic** | Overbought/Oversold | %K 20-80 | %K > 80 or < 20 |
| **Volume** | Liquidity | Volume > average | Volume too low |
| **Time of Day** | Session | During active hours | During quiet hours |

#### Filter Indicator Details

##### ADX (Average Directional Index)
- **Purpose**: Measures trend STRENGTH (not direction)
- **Range**: 0-100
- **Interpretation**:
  - ADX > 25: Strong trend (allow trend-following entries)
  - ADX < 20: Weak trend / ranging (block trend entries, allow mean-reversion)
  - ADX 20-25: Trend emerging
- **Parameters**: period (default: 14), threshold (default: 25)
- **Tip**: Use `inverse: true` for mean-reversion strategies

##### RSI Extreme Filter
- **Purpose**: Block entries at extreme overbought/oversold levels
- **Range**: 0-100
- **Logic**:
  - Block LONG when RSI > 70 (already overbought)
  - Block SHORT when RSI < 30 (already oversold)
- **Parameters**: period (14), overbought (70), oversold (30)

##### Bollinger Band Width Filter
- **Purpose**: Filter based on volatility conditions
- **Logic**:
  - Wide bands = high volatility (good for breakouts)
  - Narrow bands = low volatility (squeeze, potential breakout coming)
- **Parameters**: period (20), stdDev (2), minWidth, maxWidth

##### OBV (On-Balance Volume) Filter
- **Purpose**: Confirm trend with volume
- **Logic**:
  - OBV rising + price rising = confirmed uptrend
  - OBV falling + price rising = divergence (weak trend)
- **Parameters**: period for slope calculation

##### Momentum Filter
- **Purpose**: Confirm trend momentum
- **Range**: Oscillates around 100
- **Logic**:
  - Momentum > 100: Upward momentum (allow LONG)
  - Momentum < 100: Downward momentum (allow SHORT)
- **Parameters**: period (default: 14)

##### Stochastic Filter
- **Purpose**: Overbought/oversold filter
- **Range**: 0-100
- **Components**: %K (fast), %D (slow, signal line)
- **Logic**:
  - %K > 80: Overbought
  - %K < 20: Oversold
- **Parameters**: kPeriod (14), dPeriod (3), smooth (3)

---

### RISK (Position Sizing)

Risk components calculate HOW MUCH to trade based on volatility and risk parameters.

| Indicator | Risk Use | Calculation |
|-----------|----------|-------------|
| **ATR** | Volatility-based sizing | `quantity = riskAmount / (ATR × multiplier)` |
| **Bollinger Width** | Volatility adjustment | Wider bands → smaller position |
| **Fixed** | Simple sizing | Fixed USDT amount per trade |
| **Percent Equity** | Equity-based | Percentage of current equity |

#### Risk Calculation Details

##### ATR-Based Position Sizing
- **Purpose**: Adjust position size based on market volatility
- **Logic**: Higher volatility → larger stop distance → smaller position
- **Formula**:
  ```
  stopDistance = ATR × atrMultiplier
  riskAmount = capital × riskPercent
  quantity = riskAmount / stopDistance
  ```
- **Parameters**: atrPeriod (14), atrMultiplier (2), riskPercent (2%)
- **Benefit**: Consistent risk across different volatility conditions

##### Fixed Position Sizing
- **Purpose**: Simple, predictable position sizes
- **Logic**: Always trade same USDT value
- **Parameters**: positionSizeUsdt
- **Best For**: Testing, simple strategies

---

### EXITS (Risk Management)

Exits are supplementary risk management tools that can force position closure regardless of signal state.

| Indicator | Exit Type | Exit Condition |
|-----------|-----------|----------------|
| **ATR Stop Loss** | Fixed | Price moves ATR × multiplier against position |
| **Percent Stop Loss** | Fixed | Price moves X% against position |
| **ATR Trailing Stop** | Trailing | Price retraces ATR × multiplier from peak |
| **Parabolic SAR** | Trailing | SAR dots flip to opposite side |
| **Chandelier Exit** | Trailing | ATR-based trailing from highest high |
| **Percent Take Profit** | Target | Price moves X% in favor |
| **Time-based** | Time | Position held > N candles |
| **Max Drawdown** | Risk | Position drawdown exceeds threshold |

#### Exit Details

##### Stop Loss (ATR-based)
- **Purpose**: Limit losses based on volatility
- **Logic**: Exit when price moves ATR × multiplier against entry
- **Parameters**: atrMultiplier (2.5), atrPeriod (14)
- **Calculation**:
  - LONG: stopPrice = entryPrice - (ATR × multiplier)
  - SHORT: stopPrice = entryPrice + (ATR × multiplier)

##### Stop Loss (Percent-based)
- **Purpose**: Simple percentage-based stop
- **Logic**: Exit when price moves X% against entry
- **Parameters**: percent (2%)
- **Best For**: Simple strategies, fixed risk per trade

##### Trailing Stop (ATR-based)
- **Purpose**: Lock in profits while allowing trend to continue
- **Logic**: Trail stop at ATR × multiplier from highest/lowest price
- **Parameters**: atrMultiplier (2), activateAfterPercent (optional)
- **Behavior**:
  - Tracks highest high (LONG) or lowest low (SHORT)
  - Stop moves in favorable direction only
  - Optional: Only start trailing after X% profit

##### Take Profit (Percent-based)
- **Purpose**: Lock in profits at target
- **Logic**: Exit when price moves X% in favor
- **Parameters**: percent (2-5%)
- **Best For**: Mean-reversion strategies, scalping

##### Time-based Exit
- **Purpose**: Force exit after maximum holding period
- **Logic**: Exit if position held longer than N candles
- **Parameters**: maxHoldingCandles
- **Best For**: Avoiding stale positions, day trading

---

## Implementation Status

### Implemented ✓

#### Indicators
- [x] EMA Indicator
- [x] SMA Indicator
- [x] ADX Indicator
- [x] ATR Indicator
- [x] RSI Indicator
- [x] MACD Indicator
- [x] Donchian Channel Indicator
- [x] Bollinger Bands Indicator
- [x] Stochastic Indicator

#### Signals
- [x] EMA Crossover Signal
- [x] SMA Crossover Signal
- [x] MACD Crossover Signal
- [x] Donchian Breakout Signal
- [x] RSI Reversal Signal
- [x] Bollinger Bounce Signal

#### Filters
- [x] ADX Trend Filter
- [x] RSI Extreme Filter
- [x] Bollinger Volatility Filter
- [x] Stochastic Filter

#### Exits
- [x] ATR-based Stop Loss Exit
- [x] Percent-based Stop Loss Exit
- [x] ATR Trailing Stop Exit
- [x] Percent Take Profit Exit
- [x] Time-based Exit

#### Risk/Position Sizers
- [x] ATR-based Position Sizer
- [x] Fixed Position Sizer

### To Implement

#### Medium Priority
| Component | Type | Complexity |
|-----------|------|------------|
| Parabolic SAR Exit | Exit | Medium |

#### Low Priority
| Component | Type | Complexity |
|-----------|------|------------|
| Ichimoku Signal | Signal | High |
| Vortex Indicator | Signal | Medium |
| OBV Filter | Filter | Medium |
| CCI Filter | Filter | Low |
| Momentum Filter | Filter | Low |

---

## Example Strategy Combinations

### 1. Classic Trend Following
```json
{
  "signal": { "type": "emaCrossover", "params": { "fastPeriod": 20, "slowPeriod": 50 } },
  "filters": [
    { "type": "adxTrend", "params": { "threshold": 25 } }
  ],
  "risk": { "type": "atrBased", "params": { "atrMultiplier": 2.5, "riskPercent": 2 } },
  "exits": [
    { "type": "stopLoss", "params": { "atrMultiplier": 2.5 } },
    { "type": "trailingStop", "params": { "atrMultiplier": 2.0, "activateAfterPercent": 1.0 } }
  ]
}
```

### 2. Breakout Strategy
```json
{
  "signal": { "type": "donchianBreakout", "params": { "period": 20 } },
  "filters": [
    { "type": "adxTrend", "params": { "threshold": 20 } },
    { "type": "volatility", "params": { "minAtrPercent": 0.5 } }
  ],
  "risk": { "type": "atrBased", "params": { "atrMultiplier": 3.0, "riskPercent": 1.5 } },
  "exits": [
    { "type": "stopLoss", "params": { "atrMultiplier": 3.0 } },
    { "type": "takeProfit", "params": { "percent": 5 } }
  ]
}
```

### 3. Mean Reversion (RSI)
```json
{
  "signal": { "type": "rsiReversal", "params": { "period": 14, "oversold": 30, "overbought": 70 } },
  "filters": [
    { "type": "adxTrend", "params": { "threshold": 25, "inverse": true } }
  ],
  "risk": { "type": "fixed", "params": { "positionSizeUsdt": 1000 } },
  "exits": [
    { "type": "stopLoss", "params": { "percent": 2 } },
    { "type": "takeProfit", "params": { "percent": 2 } }
  ]
}
```

### 4. MACD Momentum
```json
{
  "signal": { "type": "macdCrossover", "params": { "fastPeriod": 12, "slowPeriod": 26, "signalPeriod": 9 } },
  "filters": [
    { "type": "adxTrend", "params": { "threshold": 20 } },
    { "type": "rsiExtreme", "params": { "overbought": 75, "oversold": 25 } }
  ],
  "risk": { "type": "atrBased", "params": { "atrMultiplier": 2, "riskPercent": 2 } },
  "exits": [
    { "type": "stopLoss", "params": { "atrMultiplier": 2 } },
    { "type": "trailingStop", "params": { "atrMultiplier": 1.5 } }
  ]
}
```

### 5. Bollinger Squeeze Breakout
```json
{
  "signal": { "type": "bollingerBreakout", "params": { "period": 20, "stdDev": 2 } },
  "filters": [
    { "type": "bollingerSqueeze", "params": { "squeezeThreshold": 0.02 } },
    { "type": "adxTrend", "params": { "threshold": 15 } }
  ],
  "risk": { "type": "atrBased", "params": { "atrMultiplier": 2, "riskPercent": 1.5 } },
  "exits": [
    { "type": "stopLoss", "params": { "atrMultiplier": 2 } },
    { "type": "takeProfit", "params": { "percent": 3 } }
  ]
}
```

---

## Indicator Synergies

### Good Combinations
| Signal | Best Filters | Rationale |
|--------|--------------|-----------|
| EMA Crossover | ADX, RSI Extreme | ADX confirms trend, RSI avoids extremes |
| MACD | ADX, Volume | ADX confirms strength, volume confirms participation |
| Donchian Breakout | ADX, Volatility | ADX confirms trend forming, volatility confirms range expansion |
| RSI Reversal | ADX (inverse), Bollinger | Low ADX = ranging (good for mean reversion) |

### Avoid Combining
| Combination | Issue |
|-------------|-------|
| Multiple trend signals | Redundant, delays entry |
| RSI signal + RSI filter | Conflicting logic |
| Too many filters | Over-filtering, missed opportunities |

---

*Document created: Indicator classification for composable strategy system*

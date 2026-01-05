export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
}

export interface Trade {
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  side: 'LONG' | 'SHORT';
  positionSize: number; // USDT position size
  pnl: number; // PnL in USDT
  pnlPercent: number; // PnL as percentage of position
  cumulativePnl: number; // Running total PnL in USDT
}

export interface BacktestResult {
  symbol: string;
  startDate: Date;
  endDate: Date;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  positionSizeUsdt: number; // Fixed position size per trade
  totalPnlUsdt: number; // Total PnL in USDT
  totalPnlPercent: number; // Total PnL as percentage
  maxDrawdownUsdt: number; // Max drawdown in USDT
  maxDrawdownPercent: number; // Max drawdown as percentage
  trades: Trade[];
}

export interface StrategySignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  price: number;
  time: number;
}

export interface StrategyConfig {
  shortPeriod: number;
  longPeriod: number;
  // ADX filter settings
  useAdxFilter: boolean;
  adxPeriod: number;
  adxThreshold: number;
  adxTimeframeMinutes: number; // e.g., 60 for 1h
}

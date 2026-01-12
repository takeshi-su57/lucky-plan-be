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
  positionSizeUsdt: number; // Average position size per trade
  totalPnlUsdt: number; // Total PnL in USDT
  totalPnlPercent: number; // Total PnL as percentage
  maxDrawdownUsdt: number; // Max drawdown in USDT
  maxDrawdownPercent: number; // Max drawdown as percentage
  trades: Trade[];
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  isCompleted: boolean;
}

export interface Trade {
  entryTime: number;
  entryPrice: number;
  exitTime: number;
  exitPrice: number;
  side: 'LONG' | 'SHORT';
  positionSize: number; // USDT position size (notional value)
  margin: number; // Collateral in USDT
  leverage: number; // Leverage multiplier
  openingFee: number; // Fee paid to open position
  closingFee: number; // Fee paid to close position
  grossPnl: number; // PnL before fees
  pnl: number; // PnL in USDT (net, after fees)
  pnlPercent: number; // PnL as percentage of margin
  cumulativePnl: number; // Running total PnL in USDT
  liquidated: boolean; // Whether position was liquidated
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

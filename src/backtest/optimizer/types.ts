/**
 * Types for the optimizer module
 */

/**
 * Metrics returned by a single backtest
 */
export interface BacktestMetrics {
  sharpeRatio: number | null;
  totalPnlPercent: number;
  totalPnlUsdt: number;
  winRate: number;
  totalTrades: number;
  maxDrawdownPercent: number;
  maxDrawdownUsdt: number;
  profitFactor: number | null;
}

/**
 * Output from run-single-backtest.ts
 */
export interface SingleBacktestOutput {
  success: boolean;
  metrics?: BacktestMetrics;
  error?: string;
}

/**
 * Parameter range for optimization
 */
export interface ParamRange {
  min: number;
  max: number;
  step?: number;
}

/**
 * Optimization configuration
 */
export interface OptimizationConfig {
  symbol: string;
  fromDate: string;
  toDate: string;
  signalType: string;
  paramRanges: Record<string, ParamRange>;
  metric: keyof BacktestMetrics;
  direction: 'maximize' | 'minimize';
  trials: number;
  capitalBase?: number;
  positionSizeUsdt?: number;
}

/**
 * Result from optimization
 */
export interface OptimizationResult {
  studyName: string;
  bestValue: number;
  bestParams: Record<string, number | boolean>;
  metric: string;
  direction: string;
  nTrials: number;
  symbol: string;
  fromDate: string;
  toDate: string;
  signal: string;
}

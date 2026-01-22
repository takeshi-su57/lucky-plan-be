import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import { Candle, Trade, BacktestResult } from './types';
import { ComposableStrategy } from './core/strategy-composer';
import {
  Position,
  TradeAction,
  StrategyConfig,
  Platform,
} from './core/interfaces';

/**
 * Options for structured result export
 */
export interface ExportOptions {
  taskId: string;
  configId: string;
  baseDir?: string;
}

/**
 * Result of structured export operation
 */
export interface ExportResult {
  folder: string;
  date: string;
  files: {
    config: string;
    tradeDetails: string;
    tradeSummary: string;
    chart: string;
  };
}

/**
 * Extended metrics for backtest results
 */
export interface ExtendedMetrics {
  sharpeRatio: number | null;
  profitFactor: number | null;
}

export interface ComposableBacktestConfig {
  symbol: string;
  initialCapital?: number;
}

export interface StreamingStats {
  candlesProcessed: number;
  tradesCompleted: number;
  currentPnlUsdt: number;
  openPosition: boolean;
}

/**
 * ComposableBacktestEngine
 *
 * Backtesting engine that works with ComposableStrategy.
 * Supports stream-based processing for memory efficiency.
 */
export class ComposableBacktestEngine {
  private strategy: ComposableStrategy;
  private config: ComposableBacktestConfig;
  private platform: Platform;
  private trades: Trade[] = [];

  // Capital tracking
  private initialCapital: number;
  private availableCapital: number;
  private lockedMargin: number = 0;
  private realizedPnL: number = 0;

  // Position tracking with leverage fields
  private currentPosition: {
    direction: 'LONG' | 'SHORT';
    entryPrice: number; // After spread (adjusted)
    entryTime: number;
    quantity: number;
    leverage: number;
    margin: number;
    notionalValue: number;
    liquidationPrice: number;
    openingFee: number;
  } | null = null;

  // Stats tracking
  private firstCandle: Candle | null = null;
  private lastCandle: Candle | null = null;
  private candleCount: number = 0;

  constructor(strategy: ComposableStrategy, config?: ComposableBacktestConfig) {
    this.strategy = strategy;
    this.platform = strategy.getPlatform();
    const strategyConfig = strategy.getConfig();
    this.initialCapital =
      config?.initialCapital ?? strategyConfig.settings.initialCapital;
    this.availableCapital = this.initialCapital;
    this.config = {
      symbol: config?.symbol ?? strategy.getSymbol(),
      initialCapital: this.initialCapital,
    };
  }

  /**
   * Reset engine state for a new backtest
   */
  reset(): void {
    this.trades = [];
    this.availableCapital = this.initialCapital;
    this.lockedMargin = 0;
    this.realizedPnL = 0;
    this.currentPosition = null;
    this.strategy.reset();
    this.firstCandle = null;
    this.lastCandle = null;
    this.candleCount = 0;
  }

  /**
   * Process a single candle
   */
  processCandle(candle: Candle): void {
    if (!this.firstCandle) {
      this.firstCandle = candle;
    }
    this.lastCandle = candle;
    this.candleCount++;

    // Check for liquidation BEFORE strategy processing
    if (this.currentPosition) {
      const result = this.platform.shouldLiquidate(
        this.currentPosition as Position,
        candle.low,
        candle.high,
      );
      if (result.liquidated) {
        this.liquidatePosition(candle.closeTime, result.liquidationPrice);
      }
    }

    // Get action from strategy
    const action = this.strategy.processCandle(candle);

    if (action) {
      this.handleAction(action, candle);
    }
  }

  /**
   * Handle a trade action from the strategy
   */
  private handleAction(action: TradeAction, _candle: Candle): void {
    if (action.type === 'EXIT') {
      this.closePosition(action.price, action.timestamp, action.reason);
    } else if (action.type === 'ENTRY') {
      // Close any existing position first
      if (this.currentPosition) {
        // If entering opposite direction, close current position
        if (this.currentPosition.direction !== action.direction) {
          this.closePosition(action.price, action.timestamp, 'Opposite signal');
        } else {
          // Same direction, skip entry
          return;
        }
      }

      // Open new position
      this.openPosition(action);
    }
    // Liquidation is now checked in processCandle BEFORE strategy processing
  }

  /**
   * Open a new position
   */
  private openPosition(action: TradeAction): void {
    if (!action.direction || !action.quantity) {
      return;
    }

    // Get leverage, margin, notionalValue from action (defaults for backward compatibility)
    const leverage = action.leverage ?? 1;
    const margin = action.margin ?? action.quantity * action.price;
    const notionalValue = action.notionalValue ?? margin;

    // Check if enough capital available
    if (this.availableCapital < margin) {
      // Not enough capital - skip trade
      return;
    }

    // Use Platform for fees/spread/liquidation
    const result = this.platform.calculateOpenPosition(
      action.direction,
      action.price,
      notionalValue,
      leverage,
      margin,
    );
    const adjustedEntryPrice = result.adjustedEntryPrice;
    const openingFee = result.openingFee;
    const liquidationPrice = result.liquidationPrice;

    // Lock margin from available capital
    this.availableCapital -= margin;
    this.lockedMargin = margin;

    // Deduct opening fee from available capital
    this.availableCapital -= openingFee;

    this.currentPosition = {
      direction: action.direction,
      entryPrice: adjustedEntryPrice,
      entryTime: action.timestamp,
      quantity: action.quantity,
      leverage,
      margin,
      notionalValue,
      liquidationPrice,
      openingFee,
    };

    // Update strategy state with full Position
    const position: Position = {
      direction: action.direction,
      entryPrice: adjustedEntryPrice,
      entryTime: action.timestamp,
      quantity: action.quantity,
      leverage,
      margin,
      notionalValue,
      liquidationPrice,
    };
    this.strategy.setPosition(position);

    // Update strategy capital state
    this.strategy.setCapitalState(
      this.availableCapital,
      this.lockedMargin,
      this.realizedPnL,
    );
  }

  /**
   * Close the current position
   */
  private closePosition(
    exitPrice: number,
    exitTime: number,
    _reason?: string,
  ): void {
    if (!this.currentPosition) return;

    const {
      direction,
      entryPrice,
      entryTime,
      leverage,
      margin,
      notionalValue,
      openingFee,
    } = this.currentPosition;

    // Use Platform for PnL calculation
    const result = this.platform.calculateClosePosition(
      this.currentPosition as Position,
      exitPrice,
    );
    const adjustedExitPrice = result.adjustedExitPrice;
    const closingFee = result.closingFee;
    const grossPnl = result.grossPnl;
    // Net PnL needs to account for opening fee as well
    let netPnl = result.netPnl - openingFee;
    // PnL percent is based on margin
    let pnlPercent = (netPnl / margin) * 100;

    // Bound negative PnL at -100% of margin (cannot lose more than collateral)
    pnlPercent = Math.max(pnlPercent, -100);
    netPnl = Math.max(netPnl, -margin);

    // Return margin + PnL to available capital
    this.availableCapital += margin + netPnl;
    this.lockedMargin = 0;
    this.realizedPnL += netPnl;

    this.trades.push({
      entryTime,
      entryPrice,
      exitTime,
      exitPrice: adjustedExitPrice,
      side: direction,
      positionSize: notionalValue,
      margin,
      leverage,
      openingFee,
      closingFee,
      grossPnl,
      pnl: netPnl,
      pnlPercent,
      cumulativePnl: this.realizedPnL,
      liquidated: false,
    });

    this.currentPosition = null;
    this.strategy.setPosition(null);
    this.strategy.setCapitalState(
      this.availableCapital,
      this.lockedMargin,
      this.realizedPnL,
    );
  }

  /**
   * Liquidate position - entire margin is lost (-100% of collateral)
   * Called when price hits liquidation price
   */
  private liquidatePosition(exitTime: number, liquidationPrice?: number): void {
    if (!this.currentPosition) return;

    const {
      direction,
      entryPrice,
      entryTime,
      leverage,
      margin,
      notionalValue,
      openingFee,
    } = this.currentPosition;

    // Liquidation = 100% loss of margin (collateral)
    const pnlPercent = -100;
    const netPnl = -margin;
    const grossPnl = -margin + openingFee; // Gross loss before opening fee

    // Margin is lost completely - do not return it to available capital
    // (margin was already deducted when opening, and opening fee was also deducted)
    this.lockedMargin = 0;
    this.realizedPnL += netPnl;

    this.trades.push({
      entryTime,
      entryPrice,
      exitTime,
      exitPrice: liquidationPrice ?? this.currentPosition.liquidationPrice,
      side: direction,
      positionSize: notionalValue,
      margin,
      leverage,
      openingFee,
      closingFee: 0, // No closing fee on liquidation
      grossPnl,
      pnl: netPnl,
      pnlPercent,
      cumulativePnl: this.realizedPnL,
      liquidated: true,
    });

    this.currentPosition = null;
    this.strategy.setPosition(null);
    this.strategy.setCapitalState(
      this.availableCapital,
      this.lockedMargin,
      this.realizedPnL,
    );
  }

  /**
   * Get current stats during streaming
   */
  getStreamingStats(): StreamingStats {
    return {
      candlesProcessed: this.candleCount,
      tradesCompleted: this.trades.length,
      currentPnlUsdt: this.realizedPnL,
      openPosition: this.currentPosition !== null,
    };
  }

  /**
   * Finalize backtest and generate results
   */
  finalize(): BacktestResult {
    // Close any open position at the end
    if (this.currentPosition && this.lastCandle) {
      this.closePosition(
        this.lastCandle.close,
        this.lastCandle.closeTime,
        'End of backtest',
      );
    }

    return this.generateResult();
  }

  /**
   * Stream-based backtest - memory efficient
   */
  async runStream(
    candleStream: AsyncIterable<Candle>,
    onProgress?: (stats: StreamingStats) => void,
    progressInterval: number = 100000,
  ): Promise<BacktestResult> {
    const strategyConfig = this.strategy.getConfig();

    console.log(`\nRunning streaming backtest...`);
    console.log(`Strategy: ${strategyConfig.name}`);
    console.log(`Symbol: ${strategyConfig.symbol}`);
    if (strategyConfig.description) {
      console.log(`Description: ${strategyConfig.description}`);
    }

    this.reset();

    let lastProgressReport = 0;

    for await (const candle of candleStream) {
      this.processCandle(candle);

      // Report progress periodically
      if (
        onProgress &&
        this.candleCount - lastProgressReport >= progressInterval
      ) {
        onProgress(this.getStreamingStats());
        lastProgressReport = this.candleCount;
      }
    }

    // Final progress report
    if (onProgress) {
      onProgress(this.getStreamingStats());
    }

    return this.finalize();
  }

  /**
   * Generate backtest result
   */
  private generateResult(): BacktestResult {
    const winningTrades = this.trades.filter((t) => t.pnl > 0);
    const losingTrades = this.trades.filter((t) => t.pnl <= 0);

    const totalPnlUsdt = this.trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalPnlPercent = this.trades.reduce(
      (sum, t) => sum + t.pnlPercent,
      0,
    );

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdownUsdt = 0;

    for (const trade of this.trades) {
      if (trade.cumulativePnl > peak) {
        peak = trade.cumulativePnl;
      }
      const drawdown = peak - trade.cumulativePnl;
      if (drawdown > maxDrawdownUsdt) {
        maxDrawdownUsdt = drawdown;
      }
    }

    // Average position size for reporting
    const avgPositionSize =
      this.trades.length > 0
        ? this.trades.reduce((sum, t) => sum + t.positionSize, 0) /
          this.trades.length
        : 0;

    const maxDrawdownPercent =
      avgPositionSize > 0 ? (maxDrawdownUsdt / avgPositionSize) * 100 : 0;

    return {
      symbol: this.config.symbol,
      startDate: new Date(this.firstCandle?.openTime || 0),
      endDate: new Date(this.lastCandle?.closeTime || 0),
      totalTrades: this.trades.length,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate:
        this.trades.length > 0
          ? (winningTrades.length / this.trades.length) * 100
          : 0,
      positionSizeUsdt: avgPositionSize,
      totalPnlUsdt,
      totalPnlPercent,
      maxDrawdownUsdt,
      maxDrawdownPercent,
      trades: this.trades,
    };
  }

  /**
   * Print results to console
   */
  static printResults(result: BacktestResult, strategyName?: string): void {
    console.log('\n========================================');
    console.log('         BACKTEST RESULTS');
    console.log('========================================\n');
    if (strategyName) {
      console.log(`Strategy:         ${strategyName}`);
    }
    console.log(`Symbol:           ${result.symbol}`);
    console.log(
      `Period:           ${result.startDate.toISOString().split('T')[0]} to ${result.endDate.toISOString().split('T')[0]}`,
    );
    console.log(`Avg Position:     ${result.positionSizeUsdt.toFixed(2)} USDT`);
    console.log(`Total Trades:     ${result.totalTrades}`);
    console.log(`Winning Trades:   ${result.winningTrades}`);
    console.log(`Losing Trades:    ${result.losingTrades}`);
    console.log(`Win Rate:         ${result.winRate.toFixed(2)}%`);
    console.log(
      `Total PnL:        ${result.totalPnlUsdt >= 0 ? '+' : ''}${result.totalPnlUsdt.toFixed(2)} USDT`,
    );
    console.log(`Total PnL %:      ${result.totalPnlPercent.toFixed(2)}%`);
    console.log(`Max Drawdown:     ${result.maxDrawdownUsdt.toFixed(2)} USDT`);
    console.log(`Max Drawdown %:   ${result.maxDrawdownPercent.toFixed(2)}%`);
    console.log('\n========================================\n');
  }

  /**
   * Export trades to CSV
   */
  static exportToCsv(result: BacktestResult, outputPath?: string): string {
    const fileName =
      outputPath || `backtest_${result.symbol}_${Date.now()}.csv`;
    const filePath = path.isAbsolute(fileName)
      ? fileName
      : path.join(process.cwd(), fileName);

    const headers = [
      'Trade #',
      'Side',
      'Entry Time',
      'Entry Price',
      'Exit Time',
      'Exit Price',
      'Position Size (USDT)',
      'Margin (USDT)',
      'Leverage',
      'Opening Fee',
      'Closing Fee',
      'Gross PnL (USDT)',
      'Net PnL (USDT)',
      'PnL (%)',
      'Cumulative PnL (USDT)',
      'Liquidated',
    ];

    const rows = result.trades.map((trade, index) => [
      index + 1,
      trade.side,
      new Date(trade.entryTime).toISOString(),
      trade.entryPrice.toFixed(2),
      new Date(trade.exitTime).toISOString(),
      trade.exitPrice.toFixed(2),
      trade.positionSize.toFixed(2),
      trade.margin.toFixed(2),
      trade.leverage.toFixed(0),
      trade.openingFee.toFixed(4),
      trade.closingFee.toFixed(4),
      trade.grossPnl.toFixed(2),
      trade.pnl.toFixed(2),
      trade.pnlPercent.toFixed(4),
      trade.cumulativePnl.toFixed(2),
      trade.liquidated ? 'Yes' : 'No',
    ]);

    // Add summary rows
    rows.push([]);
    rows.push(['Summary']);
    rows.push(['Symbol', result.symbol]);
    rows.push(['Start Date', result.startDate.toISOString()]);
    rows.push(['End Date', result.endDate.toISOString()]);
    rows.push(['Total Trades', result.totalTrades]);
    rows.push(['Winning Trades', result.winningTrades]);
    rows.push(['Losing Trades', result.losingTrades]);
    rows.push(['Win Rate (%)', result.winRate.toFixed(2)]);
    rows.push(['Total PnL (USDT)', result.totalPnlUsdt.toFixed(2)]);
    rows.push(['Total PnL (%)', result.totalPnlPercent.toFixed(2)]);
    rows.push(['Max Drawdown (USDT)', result.maxDrawdownUsdt.toFixed(2)]);
    rows.push(['Max Drawdown (%)', result.maxDrawdownPercent.toFixed(2)]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(',')),
    ].join('\n');

    fs.writeFileSync(filePath, csvContent);
    console.log(`CSV exported to: ${filePath}`);

    return filePath;
  }

  /**
   * Export PnL chart to PNG
   */
  static async exportChart(
    result: BacktestResult,
    outputPath?: string,
    strategyName?: string,
  ): Promise<string> {
    const fileName =
      outputPath || `backtest_${result.symbol}_${Date.now()}.png`;
    const filePath = path.isAbsolute(fileName)
      ? fileName
      : path.join(process.cwd(), fileName);

    // Prepare data for chart
    const labels = result.trades.map((_, i) => `${i + 1}`);
    const pnlData = result.trades.map((t) => t.cumulativePnl);

    // Create chart
    const width = 1200;
    const height = 600;
    const chartJSNodeCanvas = new ChartJSNodeCanvas({
      width,
      height,
      backgroundColour: 'white',
    });

    const title = strategyName
      ? `${strategyName} (${result.symbol}) - PnL: ${result.totalPnlUsdt >= 0 ? '+' : ''}${result.totalPnlUsdt.toFixed(2)} USDT`
      : `${result.symbol} Backtest - PnL: ${result.totalPnlUsdt >= 0 ? '+' : ''}${result.totalPnlUsdt.toFixed(2)} USDT`;

    const configuration: ChartConfiguration = {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Cumulative PnL (USDT)',
            data: pnlData,
            borderColor:
              pnlData[pnlData.length - 1] >= 0 ? '#22c55e' : '#ef4444',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            fill: true,
            tension: 0.1,
            pointRadius: 0,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: false,
        plugins: {
          title: {
            display: true,
            text: title,
            font: { size: 18 },
          },
          legend: {
            display: true,
            position: 'top',
          },
        },
        scales: {
          x: {
            title: {
              display: true,
              text: 'Trade #',
            },
            ticks: {
              maxTicksLimit: 20,
            },
          },
          y: {
            title: {
              display: true,
              text: 'Cumulative PnL (USDT)',
            },
            grid: {
              color: (context) => {
                if (context.tick.value === 0) {
                  return '#000000';
                }
                return '#e5e5e5';
              },
            },
          },
        },
      },
    };

    const buffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    fs.writeFileSync(filePath, buffer);
    console.log(`Chart exported to: ${filePath}`);

    return filePath;
  }

  /**
   * Export all results to structured folder
   * Folder structure: {baseDir}/{taskId}/{yyyy-mm-dd}/{configId}/
   */
  static async exportResults(
    result: BacktestResult,
    config: StrategyConfig,
    options: ExportOptions,
  ): Promise<ExportResult> {
    const date = new Date().toISOString().split('T')[0]; // yyyy-mm-dd
    const folder = path.join(
      options.baseDir || 'result',
      date,
      options.taskId,
      options.configId,
    );

    // Create folder recursively
    fs.mkdirSync(folder, { recursive: true });

    // Define file paths
    const files = {
      config: path.join(folder, 'config.json'),
      tradeDetails: path.join(folder, 'trade-details.csv'),
      tradeSummary: path.join(folder, 'trade-summary.csv'),
      chart: path.join(folder, 'pnl-chart.png'),
    };

    // Export all files
    this.exportConfig(config, files.config);
    this.exportTradeDetails(result, files.tradeDetails);
    this.exportTradeSummary(result, files.tradeSummary);
    await this.exportChart(result, files.chart, config.name);

    return { folder, date, files };
  }

  /**
   * Export strategy config as JSON
   */
  static exportConfig(config: StrategyConfig, filePath: string): void {
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
  }

  /**
   * Export individual trades to CSV
   */
  static exportTradeDetails(result: BacktestResult, filePath: string): void {
    const headers = [
      'Trade #',
      'Side',
      'Entry Time',
      'Entry Price',
      'Exit Time',
      'Exit Price',
      'Position Size (USDT)',
      'Margin (USDT)',
      'Leverage',
      'Opening Fee',
      'Closing Fee',
      'Gross PnL (USDT)',
      'Net PnL (USDT)',
      'PnL (%)',
      'Cumulative PnL (USDT)',
      'Liquidated',
    ];

    const rows = result.trades.map((trade, i) => [
      i + 1,
      trade.side,
      new Date(trade.entryTime).toISOString(),
      trade.entryPrice.toFixed(2),
      new Date(trade.exitTime).toISOString(),
      trade.exitPrice.toFixed(2),
      trade.positionSize.toFixed(2),
      trade.margin.toFixed(2),
      trade.leverage.toFixed(0),
      trade.openingFee.toFixed(4),
      trade.closingFee.toFixed(4),
      trade.grossPnl.toFixed(2),
      trade.pnl.toFixed(2),
      trade.pnlPercent.toFixed(4),
      trade.cumulativePnl.toFixed(2),
      trade.liquidated ? 'Yes' : 'No',
    ]);

    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    fs.writeFileSync(filePath, csv);
  }

  /**
   * Export summary statistics to CSV
   */
  static exportTradeSummary(result: BacktestResult, filePath: string): void {
    const metrics = this.calculateExtendedMetrics(result);

    const rows = [
      ['Metric', 'Value'],
      ['Symbol', result.symbol],
      ['Start Date', result.startDate.toISOString()],
      ['End Date', result.endDate.toISOString()],
      ['Total Trades', result.totalTrades],
      ['Winning Trades', result.winningTrades],
      ['Losing Trades', result.losingTrades],
      ['Win Rate (%)', result.winRate.toFixed(2)],
      ['Total PnL (USDT)', result.totalPnlUsdt.toFixed(2)],
      ['Total PnL (%)', result.totalPnlPercent.toFixed(2)],
      ['Max Drawdown (USDT)', result.maxDrawdownUsdt.toFixed(2)],
      ['Max Drawdown (%)', result.maxDrawdownPercent.toFixed(2)],
      ['Avg Position Size (USDT)', result.positionSizeUsdt.toFixed(2)],
      ['Sharpe Ratio', metrics.sharpeRatio?.toFixed(2) ?? 'N/A'],
      ['Profit Factor', metrics.profitFactor?.toFixed(2) ?? 'N/A'],
    ];

    const csv = rows.map((r) => r.join(',')).join('\n');
    fs.writeFileSync(filePath, csv);
  }

  /**
   * Calculate extended metrics (Sharpe ratio, profit factor)
   */
  static calculateExtendedMetrics(result: BacktestResult): ExtendedMetrics {
    // Profit Factor = Gross Profits / Gross Losses
    const grossProfits = result.trades
      .filter((t) => t.pnl > 0)
      .reduce((sum, t) => sum + t.pnl, 0);
    const grossLosses = Math.abs(
      result.trades.filter((t) => t.pnl < 0).reduce((sum, t) => sum + t.pnl, 0),
    );
    const profitFactor = grossLosses > 0 ? grossProfits / grossLosses : null;

    // Sharpe Ratio (simplified: using trade returns, assuming daily)
    // Sharpe = (Mean Return - Risk Free Rate) / Std Dev of Returns
    // We'll use 0 for risk-free rate and calculate based on trade PnL percentages
    if (result.trades.length < 2) {
      return { sharpeRatio: null, profitFactor };
    }

    const returns = result.trades.map((t) => t.pnlPercent);
    const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
      returns.length;
    const stdDev = Math.sqrt(variance);

    // Annualized Sharpe (assuming ~252 trading days)
    // But since we're using per-trade returns, we'll just use raw Sharpe
    const sharpeRatio = stdDev > 0 ? meanReturn / stdDev : null;

    return { sharpeRatio, profitFactor };
  }

  /**
   * Compression threshold in bytes (10KB) - files larger than this will be compressed
   */
  private static readonly COMPRESSION_THRESHOLD = 10 * 1024;

  static readResultFile(
    taskId: string,
    date: string,
    configId: string,
    fileName: string,
    baseDir: string = 'result',
  ): {
    content: string;
    contentType: string;
    size: number;
    originalSize: number;
    isCompressed: boolean;
  } | null {
    // Folder structure: baseDir/date/taskId/configId/fileName
    const filePath = path.join(baseDir, date, taskId, configId, fileName);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const stats = fs.statSync(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const originalSize = stats.size;

    let contentType: string;
    let content: string;
    let isCompressed = false;

    switch (ext) {
      case '.json':
        contentType = 'application/json';
        content = fs.readFileSync(filePath, 'utf-8');
        break;
      case '.csv':
        contentType = 'text/csv';
        content = fs.readFileSync(filePath, 'utf-8');
        break;
      case '.png':
        contentType = 'image/png';
        // Images are already binary, just base64 encode
        content = fs.readFileSync(filePath).toString('base64');
        return {
          content,
          contentType,
          size: content.length,
          originalSize,
          isCompressed: false,
        };
      default:
        contentType = 'text/plain';
        content = fs.readFileSync(filePath, 'utf-8');
    }

    // Compress text-based content if larger than threshold
    if (originalSize > this.COMPRESSION_THRESHOLD) {
      const compressed = zlib.gzipSync(Buffer.from(content, 'utf-8'));
      content = compressed.toString('base64');
      isCompressed = true;
    }

    return {
      content,
      contentType,
      size: content.length,
      originalSize,
      isCompressed,
    };
  }

  /**
   * List result dates for a task
   * Folder structure: baseDir/date/taskId/configId
   */
  static listResultDates(taskId: string, baseDir: string = 'result'): string[] {
    if (!fs.existsSync(baseDir)) {
      return [];
    }

    // List all date folders and filter to those containing this taskId
    return fs
      .readdirSync(baseDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .filter((dirent) => {
        // Check if this date folder contains the taskId subfolder
        const taskDir = path.join(baseDir, dirent.name, taskId);
        return fs.existsSync(taskDir);
      })
      .map((dirent) => dirent.name)
      .sort()
      .reverse();
  }

  /**
   * List result folders for a task and date
   */
  static listResultFolders(
    taskId: string,
    date: string,
    baseDir: string = 'result',
  ): { configId: string; files: string[] }[] {
    const dateDir = path.join(baseDir, date, taskId);
    if (!fs.existsSync(dateDir)) {
      return [];
    }

    return fs
      .readdirSync(dateDir, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => {
        const configDir = path.join(dateDir, dirent.name);
        const files = fs
          .readdirSync(configDir)
          .filter((f) => fs.statSync(path.join(configDir, f)).isFile());
        return { configId: dirent.name, files };
      });
  }
}

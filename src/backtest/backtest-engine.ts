import * as fs from 'fs';
import * as path from 'path';
import { ChartJSNodeCanvas } from 'chartjs-node-canvas';
import { ChartConfiguration } from 'chart.js';
import { Candle, Trade, BacktestResult } from './types';
import { TrendFollowingStrategy } from './trend-strategy';

export interface BacktestConfig {
  symbol: string;
  positionSizeUsdt: number; // Fixed position size per trade in USDT
  shortPeriod: number;
  longPeriod: number;
  // ADX filter options
  useAdxFilter: boolean;
  adxPeriod: number;
  adxThreshold: number;
  adxTimeframeMinutes: number;
}

const DEFAULT_CONFIG: BacktestConfig = {
  symbol: 'BTCUSDT',
  positionSizeUsdt: 1000,
  shortPeriod: 20,
  longPeriod: 50,
  useAdxFilter: false,
  adxPeriod: 14,
  adxThreshold: 20,
  adxTimeframeMinutes: 60,
};

export interface StreamingStats {
  candlesProcessed: number;
  tradesCompleted: number;
  currentPnlUsdt: number;
}

export class BacktestEngine {
  private config: BacktestConfig;
  private strategy: TrendFollowingStrategy;
  private trades: Trade[] = [];
  private cumulativePnl: number = 0;
  private currentPosition: {
    side: 'LONG' | 'SHORT';
    entryPrice: number;
    entryTime: number;
  } | null = null;

  // For streaming stats
  private firstCandle: Candle | null = null;
  private lastCandle: Candle | null = null;
  private candleCount: number = 0;

  constructor(config?: Partial<BacktestConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.strategy = new TrendFollowingStrategy({
      shortPeriod: this.config.shortPeriod,
      longPeriod: this.config.longPeriod,
      useAdxFilter: this.config.useAdxFilter,
      adxPeriod: this.config.adxPeriod,
      adxThreshold: this.config.adxThreshold,
      adxTimeframeMinutes: this.config.adxTimeframeMinutes,
    });
  }

  /**
   * Reset engine state for a new backtest
   */
  reset(): void {
    this.trades = [];
    this.cumulativePnl = 0;
    this.currentPosition = null;
    this.strategy.reset();
    this.firstCandle = null;
    this.lastCandle = null;
    this.candleCount = 0;
  }

  /**
   * Process a single candle - for streaming use
   */
  processCandle(candle: Candle): void {
    if (!this.firstCandle) {
      this.firstCandle = candle;
    }
    this.lastCandle = candle;
    this.candleCount++;

    const signal = this.strategy.processCandle(candle);

    if (signal.action === 'BUY') {
      this.handleBuySignal(candle);
    } else if (signal.action === 'SELL') {
      this.handleSellSignal(candle);
    }
  }

  /**
   * Get current stats during streaming
   */
  getStreamingStats(): StreamingStats {
    return {
      candlesProcessed: this.candleCount,
      tradesCompleted: this.trades.length,
      currentPnlUsdt: this.cumulativePnl,
    };
  }

  /**
   * Finalize backtest and generate results
   */
  finalize(): BacktestResult {
    // Close any open position at the end
    if (this.currentPosition && this.lastCandle) {
      this.closePosition(this.lastCandle.close, this.lastCandle.closeTime);
    }

    return this.generateResult();
  }

  /**
   * Stream-based backtest - memory efficient
   * Processes candles one at a time from an async generator
   */
  async runStream(
    candleStream: AsyncIterable<Candle>,
    onProgress?: (stats: StreamingStats) => void,
    progressInterval: number = 100000, // Report every N candles
  ): Promise<BacktestResult> {
    console.log(`\nRunning streaming backtest...`);
    console.log(
      `Position Size: ${this.config.positionSizeUsdt} USDT per trade`,
    );
    const adxInfo = this.config.useAdxFilter
      ? ` + ADX(${this.config.adxPeriod}) > ${this.config.adxThreshold} on ${this.config.adxTimeframeMinutes}m`
      : '';
    console.log(
      `Strategy: EMA Crossover (${this.config.shortPeriod}/${this.config.longPeriod})${adxInfo}`,
    );

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

  private handleBuySignal(candle: Candle): void {
    if (this.currentPosition?.side === 'SHORT') {
      this.closePosition(candle.close, candle.closeTime);
    }

    if (!this.currentPosition) {
      this.currentPosition = {
        side: 'LONG',
        entryPrice: candle.close,
        entryTime: candle.closeTime,
      };
    }
  }

  private handleSellSignal(candle: Candle): void {
    if (this.currentPosition?.side === 'LONG') {
      this.closePosition(candle.close, candle.closeTime);
    }

    if (!this.currentPosition) {
      this.currentPosition = {
        side: 'SHORT',
        entryPrice: candle.close,
        entryTime: candle.closeTime,
      };
    }
  }

  private closePosition(exitPrice: number, exitTime: number): void {
    if (!this.currentPosition) return;

    const { side, entryPrice, entryTime } = this.currentPosition;
    const positionSize = this.config.positionSizeUsdt;

    // Calculate PnL percentage
    let pnlPercent: number;
    if (side === 'LONG') {
      pnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;
    } else {
      pnlPercent = ((entryPrice - exitPrice) / entryPrice) * 100;
    }

    // Calculate PnL in USDT (fixed position size)
    const pnl = (pnlPercent / 100) * positionSize;

    // Update cumulative PnL
    this.cumulativePnl += pnl;

    this.trades.push({
      entryTime,
      entryPrice,
      exitTime,
      exitPrice,
      side,
      positionSize,
      pnl,
      pnlPercent,
      cumulativePnl: this.cumulativePnl,
    });

    this.currentPosition = null;
  }

  private generateResult(): BacktestResult {
    const winningTrades = this.trades.filter((t) => t.pnl > 0);
    const losingTrades = this.trades.filter((t) => t.pnl <= 0);

    const totalPnlUsdt = this.trades.reduce((sum, t) => sum + t.pnl, 0);
    const totalPnlPercent = this.trades.reduce(
      (sum, t) => sum + t.pnlPercent,
      0,
    );

    // Calculate max drawdown in USDT
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

    // Calculate max drawdown as percentage of position size
    const maxDrawdownPercent =
      this.config.positionSizeUsdt > 0
        ? (maxDrawdownUsdt / this.config.positionSizeUsdt) * 100
        : 0;

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
      positionSizeUsdt: this.config.positionSizeUsdt,
      totalPnlUsdt,
      totalPnlPercent,
      maxDrawdownUsdt,
      maxDrawdownPercent,
      trades: this.trades,
    };
  }

  static printResults(result: BacktestResult): void {
    console.log('\n========================================');
    console.log('         BACKTEST RESULTS');
    console.log('========================================\n');
    console.log(`Symbol:           ${result.symbol}`);
    console.log(
      `Period:           ${result.startDate.toISOString().split('T')[0]} to ${result.endDate.toISOString().split('T')[0]}`,
    );
    console.log(`Position Size:    ${result.positionSizeUsdt} USDT`);
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
      'PnL (USDT)',
      'PnL (%)',
      'Cumulative PnL (USDT)',
    ];

    const rows = result.trades.map((trade, index) => [
      index + 1,
      trade.side,
      new Date(trade.entryTime).toISOString(),
      trade.entryPrice.toFixed(2),
      new Date(trade.exitTime).toISOString(),
      trade.exitPrice.toFixed(2),
      trade.positionSize.toFixed(2),
      trade.pnl.toFixed(2),
      trade.pnlPercent.toFixed(4),
      trade.cumulativePnl.toFixed(2),
    ]);

    // Add summary rows
    rows.push([]);
    rows.push(['Summary']);
    rows.push(['Symbol', result.symbol]);
    rows.push(['Start Date', result.startDate.toISOString()]);
    rows.push(['End Date', result.endDate.toISOString()]);
    rows.push(['Position Size (USDT)', result.positionSizeUsdt.toFixed(2)]);
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

  static async exportChart(
    result: BacktestResult,
    outputPath?: string,
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
            text: `${result.symbol} Backtest - PnL: ${result.totalPnlUsdt >= 0 ? '+' : ''}${result.totalPnlUsdt.toFixed(2)} USDT`,
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
}

import * as fs from 'fs';
import * as path from 'path';
import { streamPriceData, getDataInfo } from './binance-fetcher';
import { Candle } from './types';
import { TrendFollowingStrategy } from './trend-strategy';

interface OptimizationConfig {
  symbol: string;
  interval: string;
  years: number;
  shortEmaMin: number;
  shortEmaMax: number;
  longEmaMin: number;
  longEmaMax: number;
  topResults: number;
}

interface BacktestResult {
  shortPeriod: number;
  longPeriod: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  totalPnlPercent: number;
  maxDrawdownPercent: number;
  profitFactor: number;
  sharpeApprox: number;
}

const DEFAULT_CONFIG: OptimizationConfig = {
  symbol: 'ETHUSDT',
  interval: '1m',
  years: 4,
  shortEmaMin: 5,
  shortEmaMax: 20,
  longEmaMin: 30,
  longEmaMax: 50,
  topResults: 10,
};

function parseArgs(): OptimizationConfig {
  const args = process.argv.slice(2);
  const config = { ...DEFAULT_CONFIG };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--symbol':
      case '-s':
        config.symbol = args[++i];
        break;
      case '--years':
      case '-y':
        config.years = parseInt(args[++i]);
        break;
      case '--short-min':
        config.shortEmaMin = parseInt(args[++i]);
        break;
      case '--short-max':
        config.shortEmaMax = parseInt(args[++i]);
        break;
      case '--long-min':
        config.longEmaMin = parseInt(args[++i]);
        break;
      case '--long-max':
        config.longEmaMax = parseInt(args[++i]);
        break;
      case '--top':
        config.topResults = parseInt(args[++i]);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return config;
}

function printHelp(): void {
  console.log(`
EMA Crossover Optimizer

Usage: npm run backtest:optimize -- [options]

Options:
  -s, --symbol <symbol>    Trading pair (default: ETHUSDT)
  -y, --years <years>      Years of data (default: 4)
  --short-min <n>          Min short EMA period (default: 5)
  --short-max <n>          Max short EMA period (default: 100)
  --long-min <n>           Min long EMA period (default: 30)
  --long-max <n>           Max long EMA period (default: 500)
  --top <n>                Number of top results to show (default: 10)
  -h, --help               Show this help message

Example:
  npm run backtest:optimize -- -s BTCUSDT -y 2 --top 20
`);
}

/**
 * Run a single backtest with given parameters (optimized - no logging)
 */
function runSingleBacktest(
  candles: Candle[],
  shortPeriod: number,
  longPeriod: number,
  initialCapital: number = 10000,
): BacktestResult {
  const strategy = new TrendFollowingStrategy({ shortPeriod, longPeriod });

  const trades: Array<{ pnlPercent: number; pnl: number }> = [];
  let currentPosition: {
    side: 'LONG' | 'SHORT';
    entryPrice: number;
  } | null = null;

  for (const candle of candles) {
    const signal = strategy.processCandle(candle);

    if (signal.action === 'BUY') {
      // Close SHORT if exists
      if (currentPosition?.side === 'SHORT') {
        const pnlPercent =
          ((currentPosition.entryPrice - candle.close) /
            currentPosition.entryPrice) *
          100;
        trades.push({ pnlPercent, pnl: (pnlPercent / 100) * initialCapital });
        currentPosition = null;
      }
      // Open LONG
      if (!currentPosition) {
        currentPosition = { side: 'LONG', entryPrice: candle.close };
      }
    } else if (signal.action === 'SELL') {
      // Close LONG if exists
      if (currentPosition?.side === 'LONG') {
        const pnlPercent =
          ((candle.close - currentPosition.entryPrice) /
            currentPosition.entryPrice) *
          100;
        trades.push({ pnlPercent, pnl: (pnlPercent / 100) * initialCapital });
        currentPosition = null;
      }
      // Open SHORT
      if (!currentPosition) {
        currentPosition = { side: 'SHORT', entryPrice: candle.close };
      }
    }
  }

  // Close any open position
  if (currentPosition && candles.length > 0) {
    const lastPrice = candles[candles.length - 1].close;
    const pnlPercent =
      currentPosition.side === 'LONG'
        ? ((lastPrice - currentPosition.entryPrice) /
            currentPosition.entryPrice) *
          100
        : ((currentPosition.entryPrice - lastPrice) /
            currentPosition.entryPrice) *
          100;
    trades.push({ pnlPercent, pnl: (pnlPercent / 100) * initialCapital });
  }

  // Calculate metrics
  const winningTrades = trades.filter((t) => t.pnl > 0);
  const losingTrades = trades.filter((t) => t.pnl <= 0);
  const totalPnlPercent = trades.reduce((sum, t) => sum + t.pnlPercent, 0);

  // Max drawdown
  let peak = initialCapital;
  let maxDrawdown = 0;
  let runningCapital = initialCapital;
  for (const trade of trades) {
    runningCapital += trade.pnl;
    if (runningCapital > peak) peak = runningCapital;
    const drawdown = ((peak - runningCapital) / peak) * 100;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  // Profit factor
  const grossProfit = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));
  const profitFactor =
    grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Approximate Sharpe (simplified)
  const returns = trades.map((t) => t.pnlPercent);
  const avgReturn =
    returns.length > 0
      ? returns.reduce((a, b) => a + b, 0) / returns.length
      : 0;
  const stdDev =
    returns.length > 1
      ? Math.sqrt(
          returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) /
            (returns.length - 1),
        )
      : 0;
  const sharpeApprox = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  return {
    shortPeriod,
    longPeriod,
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate:
      trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
    totalPnlPercent,
    maxDrawdownPercent: maxDrawdown,
    profitFactor,
    sharpeApprox,
  };
}

/**
 * Calculate composite score for ranking
 * Higher is better
 */
function calculateScore(result: BacktestResult): number {
  // Normalize metrics (rough approximations)
  const profitScore = result.totalPnlPercent / 100; // 100% = 1 point
  const winRateScore = result.winRate / 20; // 20% = 1 point
  const riskScore = Math.max(0, (100 - result.maxDrawdownPercent) / 50); // Low drawdown = good
  const profitFactorScore = Math.min(result.profitFactor, 5) / 2; // Cap at 5, 2 = 1 point

  // Weighted combination
  return (
    profitScore * 0.4 +
    winRateScore * 0.2 +
    riskScore * 0.2 +
    profitFactorScore * 0.2
  );
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('    EMA CROSSOVER OPTIMIZER');
  console.log('='.repeat(60));

  const config = parseArgs();

  console.log('\nConfiguration:');
  console.log(`  Symbol:       ${config.symbol}`);
  console.log(`  Years:        ${config.years}`);
  console.log(`  Short EMA:    ${config.shortEmaMin} - ${config.shortEmaMax}`);
  console.log(`  Long EMA:     ${config.longEmaMin} - ${config.longEmaMax}`);

  // Check cache
  const info = getDataInfo(config.symbol, config.interval, config.years);
  console.log(`\nData Info:`);
  console.log(`  Cached months: ${info.cachedMonths}/${info.totalMonths}`);

  if (info.cachedMonths < info.totalMonths) {
    console.log(
      `\n⚠️  Need to fetch ${info.totalMonths - info.cachedMonths} months first.`,
    );
    console.log(
      `   Run: npm run backtest -- -s ${config.symbol} -y ${config.years}`,
    );
    process.exit(1);
  }

  // Load all candles into memory (needed for multiple backtests)
  console.log('\nLoading price data...');
  const candles: Candle[] = [];
  for await (const candle of streamPriceData(
    config.symbol,
    config.interval,
    config.years,
  )) {
    candles.push(candle);
  }
  console.log(`Loaded ${candles.length.toLocaleString()} candles`);

  // Generate all valid combinations
  const combinations: Array<{ short: number; long: number }> = [];
  for (let short = config.shortEmaMin; short <= config.shortEmaMax; short++) {
    const longMin = Math.max(config.longEmaMin, short + 1);
    for (let long = longMin; long <= config.longEmaMax; long++) {
      combinations.push({ short, long });
    }
  }

  console.log(
    `\nTesting ${combinations.length.toLocaleString()} EMA combinations...`,
  );
  console.log('');

  // Run all backtests
  const results: BacktestResult[] = [];
  const startTime = Date.now();

  for (let i = 0; i < combinations.length; i++) {
    const { short, long } = combinations[i];
    const result = runSingleBacktest(candles, short, long);
    results.push(result);

    // Progress update every 1%
    if (
      (i + 1) % Math.ceil(combinations.length / 100) === 0 ||
      i === combinations.length - 1
    ) {
      const progress = (((i + 1) / combinations.length) * 100).toFixed(1);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      process.stdout.write(
        `\rProgress: ${progress}% (${i + 1}/${combinations.length}) - ${elapsed}s`,
      );
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`\n\nCompleted in ${totalTime}s`);

  // Sort by composite score
  results.sort((a, b) => calculateScore(b) - calculateScore(a));

  // Get top results
  const topResults = results.slice(0, config.topResults);

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log(`    TOP ${config.topResults} EMA COMBINATIONS`);
  console.log('='.repeat(60));

  console.log(
    '\n┌──────┬───────┬───────────┬──────────┬──────────┬─────────────┬────────────┐',
  );
  console.log(
    '│ Rank │ EMA   │ Trades    │ Win Rate │ PnL %    │ Max DD %    │ Profit Fac │',
  );
  console.log(
    '├──────┼───────┼───────────┼──────────┼──────────┼─────────────┼────────────┤',
  );

  topResults.forEach((r, i) => {
    const rank = String(i + 1).padStart(4);
    const ema = `${r.shortPeriod}/${r.longPeriod}`.padEnd(5);
    const trades = r.totalTrades.toLocaleString().padStart(9);
    const winRate = `${r.winRate.toFixed(2)}%`.padStart(8);
    const pnl =
      `${r.totalPnlPercent >= 0 ? '+' : ''}${r.totalPnlPercent.toFixed(2)}%`.padStart(
        8,
      );
    const maxDD = `${r.maxDrawdownPercent.toFixed(2)}%`.padStart(11);
    const pf =
      r.profitFactor === Infinity
        ? '∞'.padStart(10)
        : r.profitFactor.toFixed(2).padStart(10);

    console.log(
      `│ ${rank} │ ${ema} │ ${trades} │ ${winRate} │ ${pnl} │ ${maxDD} │ ${pf} │`,
    );
  });

  console.log(
    '└──────┴───────┴───────────┴──────────┴──────────┴─────────────┴────────────┘',
  );

  // Export to CSV
  const csvFileName = `optimization_${config.symbol}_${Date.now()}.csv`;
  const csvHeaders = [
    'Rank',
    'Short EMA',
    'Long EMA',
    'Total Trades',
    'Winning Trades',
    'Losing Trades',
    'Win Rate %',
    'Total PnL %',
    'Max Drawdown %',
    'Profit Factor',
    'Sharpe Approx',
    'Score',
  ];

  const csvRows = results.map((r, i) => [
    i + 1,
    r.shortPeriod,
    r.longPeriod,
    r.totalTrades,
    r.winningTrades,
    r.losingTrades,
    r.winRate.toFixed(4),
    r.totalPnlPercent.toFixed(4),
    r.maxDrawdownPercent.toFixed(4),
    r.profitFactor === Infinity ? 'Infinity' : r.profitFactor.toFixed(4),
    r.sharpeApprox.toFixed(4),
    calculateScore(r).toFixed(4),
  ]);

  const csvContent = [
    csvHeaders.join(','),
    ...csvRows.map((row) => row.join(',')),
  ].join('\n');
  fs.writeFileSync(csvFileName, csvContent);
  console.log(`\nFull results exported to: ${csvFileName}`);

  // Summary of best
  const best = topResults[0];
  console.log('\n' + '='.repeat(60));
  console.log('    RECOMMENDED PARAMETERS');
  console.log('='.repeat(60));
  console.log(`\n  Short EMA:      ${best.shortPeriod}`);
  console.log(`  Long EMA:       ${best.longPeriod}`);
  console.log(
    `  Expected PnL:   ${best.totalPnlPercent >= 0 ? '+' : ''}${best.totalPnlPercent.toFixed(2)}%`,
  );
  console.log(`  Win Rate:       ${best.winRate.toFixed(2)}%`);
  console.log(`  Max Drawdown:   ${best.maxDrawdownPercent.toFixed(2)}%`);
  console.log(
    `  Profit Factor:  ${best.profitFactor === Infinity ? '∞' : best.profitFactor.toFixed(2)}`,
  );
  console.log('');
}

main().catch(console.error);

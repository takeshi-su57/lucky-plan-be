import * as fs from 'fs';
import * as path from 'path';
import { streamPriceData, getDataInfo } from './binance-fetcher';
import { BacktestEngine } from './backtest-engine';

interface BacktestOptions {
  symbol: string;
  interval: string;
  years: number;
  shortPeriod: number;
  longPeriod: number;
  positionSizeUsdt: number;
  outputFile?: string;
  // ADX filter options
  useAdxFilter: boolean;
  adxPeriod: number;
  adxThreshold: number;
  adxTimeframeMinutes: number;
}

const DEFAULT_OPTIONS: BacktestOptions = {
  symbol: 'BTCUSDT',
  interval: '1m',
  years: 4,
  shortPeriod: 20,
  longPeriod: 50,
  positionSizeUsdt: 1000,
  useAdxFilter: false,
  adxPeriod: 14,
  adxThreshold: 20,
  adxTimeframeMinutes: 60,
};

function parseArgs(): BacktestOptions {
  const args = process.argv.slice(2);
  const options = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--symbol':
      case '-s':
        options.symbol = args[++i];
        break;
      case '--interval':
      case '-i':
        options.interval = args[++i];
        break;
      case '--years':
      case '-y':
        options.years = parseInt(args[++i]);
        break;
      case '--short':
        options.shortPeriod = parseInt(args[++i]);
        break;
      case '--long':
        options.longPeriod = parseInt(args[++i]);
        break;
      case '--position-size':
      case '-p':
        options.positionSizeUsdt = parseFloat(args[++i]);
        break;
      case '--output':
      case '-o':
        options.outputFile = args[++i];
        break;
      case '--adx':
        options.useAdxFilter = true;
        break;
      case '--adx-period':
        options.adxPeriod = parseInt(args[++i]);
        break;
      case '--adx-threshold':
        options.adxThreshold = parseInt(args[++i]);
        break;
      case '--adx-timeframe':
        options.adxTimeframeMinutes = parseInt(args[++i]);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
Trend Following Backtest

Usage: npm run backtest -- [options]

Options:
  -s, --symbol <symbol>      Trading pair (default: BTCUSDT)
  -i, --interval <int>       Candle interval: 1m, 5m, 1h, etc (default: 1m)
  -y, --years <years>        Years of data to fetch (default: 4)
  --short <period>           Short EMA period (default: 20)
  --long <period>            Long EMA period (default: 50)
  -p, --position-size <usdt> Position size per trade in USDT (default: 1000)
  -o, --output <file>        Output file base name (without extension)
  -h, --help                 Show this help message

ADX Filter Options:
  --adx                      Enable ADX filter (only trade in trending markets)
  --adx-period <period>      ADX calculation period (default: 14)
  --adx-threshold <value>    Min ADX value for trading (default: 20)
  --adx-timeframe <minutes>  ADX timeframe in minutes (default: 60 = 1h)

Output:
  Two files are generated:
  - <output>.csv  - Detailed trade list with cumulative PnL
  - <output>.png  - PnL chart visualization

Examples:
  npm run backtest
  npm run backtest -- -s ETHUSDT -y 2
  npm run backtest -- --short 10 --long 30 -p 500
  npm run backtest -- -s BTCUSDT --adx --adx-threshold 25
`);
}

function formatNumber(num: number): string {
  return num.toLocaleString();
}

function formatUsdt(num: number): string {
  const sign = num >= 0 ? '+' : '';
  return `${sign}${num.toFixed(2)} USDT`;
}

async function main(): Promise<void> {
  console.log('='.repeat(50));
  console.log('    TREND FOLLOWING BACKTEST');
  console.log('='.repeat(50));

  const options = parseArgs();

  console.log('\nConfiguration:');
  console.log(`  Symbol:         ${options.symbol}`);
  console.log(`  Interval:       ${options.interval}`);
  console.log(`  Years:          ${options.years}`);
  console.log(`  Short EMA:      ${options.shortPeriod}`);
  console.log(`  Long EMA:       ${options.longPeriod}`);
  console.log(`  Position Size:  ${options.positionSizeUsdt} USDT`);
  if (options.useAdxFilter) {
    console.log(`  ADX Filter:     enabled`);
    console.log(`  ADX Period:     ${options.adxPeriod}`);
    console.log(`  ADX Threshold:  ${options.adxThreshold}`);
    console.log(`  ADX Timeframe:  ${options.adxTimeframeMinutes}m`);
  } else {
    console.log(`  ADX Filter:     disabled`);
  }

  try {
    const info = getDataInfo(options.symbol, options.interval, options.years);
    console.log(`\nData Info:`);
    console.log(`  Total months: ${info.totalMonths}`);
    console.log(`  Cached months: ${info.cachedMonths}`);
    console.log(
      `  Need to fetch: ${info.totalMonths - info.cachedMonths} months`,
    );

    const engine = new BacktestEngine({
      symbol: options.symbol,
      positionSizeUsdt: options.positionSizeUsdt,
      shortPeriod: options.shortPeriod,
      longPeriod: options.longPeriod,
      useAdxFilter: options.useAdxFilter,
      adxPeriod: options.adxPeriod,
      adxThreshold: options.adxThreshold,
      adxTimeframeMinutes: options.adxTimeframeMinutes,
    });

    const stream = streamPriceData(
      options.symbol,
      options.interval,
      options.years,
      (progress) => {
        const prefix = `[${progress.monthIndex + 1}/${progress.totalMonths}] ${progress.currentMonth}`;
        if (progress.status === 'cached') {
          process.stdout.write(
            `\r${prefix}: cached (${formatNumber(progress.candlesInMonth)} candles)\n`,
          );
        } else if (progress.status === 'done') {
          process.stdout.write(
            `\r${prefix}: done (${formatNumber(progress.candlesInMonth)} candles)          \n`,
          );
        } else {
          process.stdout.write(`\r${prefix}: ${progress.status}...          `);
        }
      },
    );

    const result = await engine.runStream(
      stream,
      (stats) => {
        process.stdout.write(
          `\rProcessed: ${formatNumber(stats.candlesProcessed)} candles | ` +
            `Trades: ${formatNumber(stats.tradesCompleted)} | ` +
            `PnL: ${formatUsdt(stats.currentPnlUsdt)}          `,
        );
      },
      50000,
    );

    console.log('');

    BacktestEngine.printResults(result);

    // Create result folder structure: result/{symbol}/{strategy}/
    const strategy = 'trendfollower';
    const resultDir = path.join(
      process.cwd(),
      'result',
      options.symbol,
      strategy,
    );
    if (!fs.existsSync(resultDir)) {
      fs.mkdirSync(resultDir, { recursive: true });
    }

    // Generate output file names
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const baseFileName =
      options.outputFile ||
      `${options.shortPeriod}_${options.longPeriod}_${options.useAdxFilter ? 'adx' : 'nofilter'}_${timestamp}`;
    const csvFile = path.join(resultDir, `${baseFileName}.csv`);
    const chartFile = path.join(resultDir, `${baseFileName}.png`);

    // Export CSV and Chart
    BacktestEngine.exportToCsv(result, csvFile);
    await BacktestEngine.exportChart(result, chartFile);

    console.log('\nBacktest completed successfully!');
  } catch (error) {
    console.error('\nBacktest failed:', error);
    process.exit(1);
  }
}

main();

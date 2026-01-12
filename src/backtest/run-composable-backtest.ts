import * as fs from 'fs';
import * as path from 'path';
import { streamPriceData, getDataInfo } from './binance-fetcher';
import { aggregateCandleStream } from './candle-aggregator';
import { ComposableBacktestEngine } from './composable-backtest-engine';
import { StrategyLoader } from './core/strategy-loader';
import { ComposableStrategy } from './core/strategy-composer';
import { STRATEGIES_DIR } from './config/strategies';

interface BacktestOptions {
  config?: string;
  symbol?: string;
  interval: string;
  fromDate?: Date;
  toDate?: Date;
  outputFile?: string;
  listStrategies: boolean;
}

const DEFAULT_OPTIONS: BacktestOptions = {
  interval: '1m',
  listStrategies: false,
};

function parseArgs(): BacktestOptions {
  const args = process.argv.slice(2);
  const options = { ...DEFAULT_OPTIONS };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--config':
      case '-c':
        options.config = args[++i];
        break;
      case '--symbol':
      case '-s':
        options.symbol = args[++i];
        break;
      case '--interval':
      case '-i':
        options.interval = args[++i];
        break;
      case '--from':
      case '-f':
        options.fromDate = new Date(args[++i]);
        break;
      case '--to':
      case '-t':
        options.toDate = new Date(args[++i]);
        break;
      case '--output':
      case '-o':
        options.outputFile = args[++i];
        break;
      case '--list':
      case '-l':
        options.listStrategies = true;
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
Composable Strategy Backtest

Usage: npx ts-node src/backtest/run-composable-backtest.ts [options]

Options:
  -c, --config <path>        Path to strategy JSON config file
  -s, --symbol <symbol>      Symbol to use (loads from config/strategies/<symbol>.json)
  -i, --interval <int>       Candle interval: 1m, 5m, 1h, etc (default: 1m)
  -f, --from <date>          Start date (required, format: YYYY-MM-DD)
  -t, --to <date>            End date (required, format: YYYY-MM-DD)
  -o, --output <file>        Output file base name (without extension)
  -l, --list                 List available strategies
  -h, --help                 Show this help message

Examples:
  # Run with a specific config file
  npx ts-node src/backtest/run-composable-backtest.ts -c ./my-strategy.json -f 2022-01-01 -t 2024-01-01

  # Run with a built-in strategy (by symbol)
  npx ts-node src/backtest/run-composable-backtest.ts -s BTCUSDT -f 2023-01-01 -t 2024-01-01

  # List available strategies
  npx ts-node src/backtest/run-composable-backtest.ts --list

Output:
  Two files are generated in result/<symbol>/<strategy-name>/:
  - <output>.csv  - Detailed trade list with cumulative PnL
  - <output>.png  - PnL chart visualization
`);
}

function listStrategies(): void {
  console.log('\nAvailable strategies:');
  console.log(`  Directory: ${STRATEGIES_DIR}\n`);

  try {
    const files = fs
      .readdirSync(STRATEGIES_DIR)
      .filter((f) => f.endsWith('.json'));

    if (files.length === 0) {
      console.log('  No strategy files found.\n');
      return;
    }

    files.forEach((file) => {
      const filePath = path.join(STRATEGIES_DIR, file);
      const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      console.log(`  ${config.symbol.padEnd(12)} - ${config.name}`);
      if (config.description) {
        console.log(`${''.padEnd(16)}${config.description}`);
      }
    });
    console.log('');
  } catch (error) {
    console.error('  Error listing strategies:', error);
  }
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
  console.log('    COMPOSABLE STRATEGY BACKTEST');
  console.log('='.repeat(50));

  const options = parseArgs();

  if (options.listStrategies) {
    listStrategies();
    return;
  }

  // Load strategy config
  let strategy: ComposableStrategy;
  let configPath: string;

  if (options.config) {
    // Load from specified path
    configPath = options.config;
    strategy = StrategyLoader.loadStrategy(configPath);
  } else if (options.symbol) {
    // Load from built-in strategies
    configPath = path.join(STRATEGIES_DIR, `${options.symbol}.json`);
    if (!fs.existsSync(configPath)) {
      console.error(`\nError: No strategy found for symbol ${options.symbol}`);
      console.error(`Expected file: ${configPath}`);
      console.error('\nUse --list to see available strategies.');
      process.exit(1);
    }
    strategy = StrategyLoader.loadStrategy(configPath);
  } else {
    console.error('\nError: Please specify either --config or --symbol');
    console.error('Use --help for usage information.');
    process.exit(1);
  }

  const strategyConfig = strategy.getConfig();

  console.log('\nStrategy Configuration:');
  console.log(`  Name:           ${strategyConfig.name}`);
  console.log(`  Symbol:         ${strategyConfig.symbol}`);
  if (strategyConfig.description) {
    console.log(`  Description:    ${strategyConfig.description}`);
  }
  console.log(`  Signal:         ${strategyConfig.signal.type}`);
  console.log(
    `  Filters:        ${strategyConfig.filters.length > 0 ? strategyConfig.filters.map((f) => f.type).join(', ') : 'none'}`,
  );
  console.log(`  Risk:           ${strategyConfig.risk.type}`);
  console.log(
    `  Exits:          ${strategyConfig.exits.map((e) => e.type).join(', ')}`,
  );

  // Validate date options
  if (!options.fromDate || !options.toDate) {
    console.error('\nError: Both --from and --to dates are required');
    console.error('Use --help for usage information.');
    process.exit(1);
  }

  if (isNaN(options.fromDate.getTime()) || isNaN(options.toDate.getTime())) {
    console.error('\nError: Invalid date format. Use YYYY-MM-DD');
    process.exit(1);
  }

  if (options.fromDate >= options.toDate) {
    console.error('\nError: --from date must be before --to date');
    process.exit(1);
  }

  const fromDateStr = options.fromDate.toISOString().split('T')[0];
  const toDateStr = options.toDate.toISOString().split('T')[0];

  console.log('\nBacktest Configuration:');
  console.log(
    `  Interval:       ${options.interval}${options.interval !== '1m' ? ' (aggregated from 1m)' : ''}`,
  );
  console.log(`  From:           ${fromDateStr}`);
  console.log(`  To:             ${toDateStr}`);

  try {
    // Always check 1m data since we aggregate from it
    const info = getDataInfo(
      strategyConfig.symbol,
      '1m',
      options.fromDate,
      options.toDate,
    );
    console.log(`\nData Info:`);
    console.log(`  Total months: ${info.totalMonths}`);
    console.log(`  Cached months: ${info.cachedMonths}`);
    console.log(
      `  Need to fetch: ${info.totalMonths - info.cachedMonths} months`,
    );

    const engine = new ComposableBacktestEngine(strategy, {
      symbol: strategyConfig.symbol,
      capitalBase: strategyConfig.settings?.capitalBase,
    });

    // Always fetch 1m data, then aggregate to target interval if needed
    const sourceInterval = '1m';
    const sourceStream = streamPriceData(
      strategyConfig.symbol,
      sourceInterval,
      options.fromDate,
      options.toDate,
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

    // Aggregate to target interval if different from source
    const stream =
      options.interval === sourceInterval
        ? sourceStream
        : aggregateCandleStream(sourceStream, options.interval);

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

    ComposableBacktestEngine.printResults(result, strategyConfig.name);

    // Create result folder structure: result/{symbol}/{strategy-name}/
    const strategySlug = strategyConfig.name.toLowerCase().replace(/\s+/g, '-');
    const resultDir = path.join(
      process.cwd(),
      'result',
      strategyConfig.symbol,
      strategySlug,
    );
    if (!fs.existsSync(resultDir)) {
      fs.mkdirSync(resultDir, { recursive: true });
    }

    // Generate output file names
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const baseFileName = options.outputFile || `${strategySlug}_${timestamp}`;
    const csvFile = path.join(resultDir, `${baseFileName}.csv`);
    const chartFile = path.join(resultDir, `${baseFileName}.png`);

    // Export CSV and Chart
    ComposableBacktestEngine.exportToCsv(result, csvFile);
    await ComposableBacktestEngine.exportChart(
      result,
      chartFile,
      strategyConfig.name,
    );

    console.log('\nBacktest completed successfully!');
  } catch (error) {
    console.error('\nBacktest failed:', error);
    process.exit(1);
  }
}

main();

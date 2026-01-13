import * as fs from 'fs';
import * as path from 'path';
import { Candle } from './types';

const BINANCE_API_URL = 'https://api.binance.com/api/v3/klines';
const PRICES_DIR = path.join(process.cwd(), 'prices');
const MAX_CANDLES_PER_REQUEST = 1000;
const CACHE_STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// Rate limiting: Binance allows 1200 requests per minute
const DELAY_BETWEEN_REQUESTS = 100; // ms

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the bucket file path for a specific month
 * Structure: prices/{symbol}/{interval}/{yyyy-mm}.json
 */
function getBucketPath(
  symbol: string,
  interval: string,
  year: number,
  month: number,
): string {
  const monthStr = String(month).padStart(2, '0');
  return path.join(PRICES_DIR, symbol, interval, `${year}-${monthStr}.json`);
}

/**
 * Ensure directory exists for bucket storage
 */
function ensureBucketDir(symbol: string, interval: string): void {
  const dir = path.join(PRICES_DIR, symbol, interval);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load candles from a monthly bucket file
 * Adds isCompleted: true to all candles (for backwards compatibility with old cache files)
 */
function loadBucket(
  symbol: string,
  interval: string,
  year: number,
  month: number,
): Candle[] | null {
  const filePath = getBucketPath(symbol, interval, year, month);
  if (fs.existsSync(filePath)) {
    const data = fs.readFileSync(filePath, 'utf-8');
    const candles = JSON.parse(data) as Candle[];
    // Ensure all cached candles have isCompleted set (backwards compatibility)
    return candles.map((c) => ({ ...c, isCompleted: true }));
  }
  return null;
}

/**
 * Save candles to a monthly bucket file
 */
function saveBucket(
  symbol: string,
  interval: string,
  year: number,
  month: number,
  candles: Candle[],
): void {
  ensureBucketDir(symbol, interval);
  const filePath = getBucketPath(symbol, interval, year, month);
  fs.writeFileSync(filePath, JSON.stringify(candles, null, 2));
}

/**
 * Get file modification time
 */
function getBucketModTime(
  symbol: string,
  interval: string,
  year: number,
  month: number,
): number | null {
  const filePath = getBucketPath(symbol, interval, year, month);
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    return stats.mtimeMs;
  }
  return null;
}

/**
 * Check if a bucket is stale (for current month only)
 */
function isBucketStale(
  symbol: string,
  interval: string,
  year: number,
  month: number,
): boolean {
  const modTime = getBucketModTime(symbol, interval, year, month);
  if (!modTime) return true;
  return Date.now() - modTime > CACHE_STALE_THRESHOLD_MS;
}

/**
 * Get start and end timestamps for a specific month
 */
function getMonthRange(
  year: number,
  month: number,
): { start: number; end: number } {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0).getTime();
  const end = new Date(year, month, 0, 23, 59, 59, 999).getTime();
  return { start, end };
}

/**
 * Generate list of months between two dates
 */
function getMonthsBetween(
  startTime: number,
  endTime: number,
): Array<{ year: number; month: number }> {
  const months: Array<{ year: number; month: number }> = [];
  const startDate = new Date(startTime);
  const endDate = new Date(endTime);

  let year = startDate.getFullYear();
  let month = startDate.getMonth() + 1;

  while (
    year < endDate.getFullYear() ||
    (year === endDate.getFullYear() && month <= endDate.getMonth() + 1)
  ) {
    months.push({ year, month });
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }

  return months;
}

function parseCandle(raw: unknown[]): Candle {
  return {
    openTime: raw[0] as number,
    open: parseFloat(raw[1] as string),
    high: parseFloat(raw[2] as string),
    low: parseFloat(raw[3] as string),
    close: parseFloat(raw[4] as string),
    volume: parseFloat(raw[5] as string),
    closeTime: raw[6] as number,
    isCompleted: true, // Historical candles from Binance are always completed
  };
}

/**
 * Fetch candles for a specific time range from Binance
 */
async function fetchCandlesFromBinance(
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  onProgress?: (fetched: number) => void,
): Promise<Candle[]> {
  const allCandles: Candle[] = [];
  let currentStartTime = startTime;

  while (currentStartTime < endTime) {
    const url = new URL(BINANCE_API_URL);
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('startTime', currentStartTime.toString());
    url.searchParams.set('endTime', endTime.toString());
    url.searchParams.set('limit', MAX_CANDLES_PER_REQUEST.toString());

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(
        `Binance API error: ${response.status} ${response.statusText}`,
      );
    }

    const data = (await response.json()) as unknown[][];

    if (data.length === 0) {
      break;
    }

    const candles = data.map(parseCandle);
    allCandles.push(...candles);
    currentStartTime = candles[candles.length - 1].closeTime + 1;

    if (onProgress) {
      onProgress(allCandles.length);
    }

    await sleep(DELAY_BETWEEN_REQUESTS);
  }

  return allCandles;
}

/**
 * Fetch candles for a specific month (with caching)
 */
async function fetchMonthData(
  symbol: string,
  interval: string,
  year: number,
  month: number,
  isCurrentMonth: boolean,
  onProgress?: (fetched: number) => void,
): Promise<Candle[]> {
  const { start, end } = getMonthRange(year, month);
  const now = Date.now();
  const effectiveEnd = Math.min(end, now);

  // Check cache
  const cached = loadBucket(symbol, interval, year, month);

  if (cached && cached.length > 0) {
    // For current month, check if stale
    if (isCurrentMonth) {
      if (!isBucketStale(symbol, interval, year, month)) {
        return cached;
      }
      // Stale - fetch only missing data from last candle
      const lastCandleTime = cached[cached.length - 1].closeTime;
      if (lastCandleTime >= effectiveEnd) {
        return cached;
      }

      const newCandles = await fetchCandlesFromBinance(
        symbol,
        interval,
        lastCandleTime + 1,
        effectiveEnd,
        onProgress,
      );

      if (newCandles.length > 0) {
        const merged = [...cached, ...newCandles];
        const unique = removeDuplicates(merged);
        saveBucket(symbol, interval, year, month, unique);
        return unique;
      }
      return cached;
    }

    // Past month - use cache directly
    return cached;
  }

  // No cache - fetch full month
  const candles = await fetchCandlesFromBinance(
    symbol,
    interval,
    start,
    effectiveEnd,
    onProgress,
  );

  if (candles.length > 0) {
    saveBucket(symbol, interval, year, month, candles);
  }

  return candles;
}

function removeDuplicates(candles: Candle[]): Candle[] {
  const seen = new Set<number>();
  const unique: Candle[] = [];

  for (const candle of candles) {
    if (!seen.has(candle.openTime)) {
      seen.add(candle.openTime);
      unique.push(candle);
    }
  }

  return unique.sort((a, b) => a.openTime - b.openTime);
}

/**
 * Progress callback type for streaming
 */
export type StreamProgress = {
  currentMonth: string;
  monthIndex: number;
  totalMonths: number;
  candlesInMonth: number;
  status: 'cached' | 'fetching' | 'updating' | 'done';
};

/**
 * Stream price data as an async generator - yields candles one at a time
 * Memory efficient: only one month's data in memory at a time
 * Only yields candles within the specified date range
 */
export async function* streamPriceData(
  symbol: string,
  interval: string = '1m',
  fromDate: Date,
  toDate: Date,
  onProgress?: (progress: StreamProgress) => void,
): AsyncGenerator<Candle, void, unknown> {
  // Convert dates to timestamps
  const startTime = fromDate.getTime();
  const endTime = toDate.getTime();

  // Get all months to fetch
  const months = getMonthsBetween(startTime, endTime);
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const currentMonth = currentDate.getMonth() + 1;

  for (let i = 0; i < months.length; i++) {
    const { year, month } = months[i];
    const monthStr = `${year}-${String(month).padStart(2, '0')}`;
    const isCurrentMonth = year === currentYear && month === currentMonth;

    // Check if bucket exists
    const cached = loadBucket(symbol, interval, year, month);
    const hasCachedData = cached && cached.length > 0;

    if (hasCachedData && !isCurrentMonth) {
      // Use cached data - yield each candle within range
      const filteredCandles = cached.filter(
        (c) => c.openTime >= startTime && c.openTime <= endTime,
      );

      if (onProgress) {
        onProgress({
          currentMonth: monthStr,
          monthIndex: i,
          totalMonths: months.length,
          candlesInMonth: filteredCandles.length,
          status: 'cached',
        });
      }

      for (const candle of filteredCandles) {
        yield candle;
      }
    } else {
      // Fetch data
      const status = isCurrentMonth && hasCachedData ? 'updating' : 'fetching';

      if (onProgress) {
        onProgress({
          currentMonth: monthStr,
          monthIndex: i,
          totalMonths: months.length,
          candlesInMonth: 0,
          status,
        });
      }

      const candles = await fetchMonthData(
        symbol,
        interval,
        year,
        month,
        isCurrentMonth,
      );

      // Filter candles to only include those within the date range
      const filteredCandles = candles.filter(
        (c) => c.openTime >= startTime && c.openTime <= endTime,
      );

      if (onProgress) {
        onProgress({
          currentMonth: monthStr,
          monthIndex: i,
          totalMonths: months.length,
          candlesInMonth: filteredCandles.length,
          status: 'done',
        });
      }

      // Yield each candle one at a time
      for (const candle of filteredCandles) {
        yield candle;
      }
    }
  }
}

/**
 * Get metadata about available data without loading it all
 */
export function getDataInfo(
  symbol: string,
  interval: string,
  fromDate: Date,
  toDate: Date,
): {
  totalMonths: number;
  cachedMonths: number;
  months: Array<{
    year: number;
    month: number;
    cached: boolean;
    candles: number;
  }>;
} {
  const startTime = fromDate.getTime();
  const endTime = toDate.getTime();
  const months = getMonthsBetween(startTime, endTime);

  const monthsInfo = months.map(({ year, month }) => {
    const cached = loadBucket(symbol, interval, year, month);
    return {
      year,
      month,
      cached: cached !== null && cached.length > 0,
      candles: cached?.length ?? 0,
    };
  });

  return {
    totalMonths: months.length,
    cachedMonths: monthsInfo.filter((m) => m.cached).length,
    months: monthsInfo,
  };
}

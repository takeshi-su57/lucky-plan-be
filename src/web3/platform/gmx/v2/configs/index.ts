import { MarketConfig, Token } from '../types';

import marketsSnapshot from './markets.generated.json';
import tokensSnapshot from './tokens.generated.json';

/**
 * Committed GMX V2 market/token snapshots, regenerated with
 * `npm run config:generate:gmx-v2`. Token metadata (symbols, decimals of
 * synthetic index tokens) is not readable on-chain, so the generator and the
 * runtime sync (GmxV2ConfigSyncService) both merge GMX's public API into the
 * snapshot and keep existing hand-curated entries.
 *
 * Keyed by chain id, then address (markets: checksum, tokens: lowercase).
 */
export const gmxMarketConfigs = marketsSnapshot as Record<
  string,
  Record<string, MarketConfig>
>;
export const gmxTokenConfigs = tokensSnapshot as Record<
  string,
  Record<string, Token>
>;

export type GmxV2ConfigSource = 'Snapshot' | 'Synced';

const marketMap = new Map<string, MarketConfig>();
const tokenMap = new Map<string, Token>();
const syncedMarketKeys = new Set<string>();
const syncedTokenKeys = new Set<string>();

const marketKey = (chainId: number | string, market: string) =>
  `${chainId}-${market}`.toLowerCase();

for (const [chainId, markets] of Object.entries(gmxMarketConfigs)) {
  for (const [market, marketConfig] of Object.entries(markets)) {
    marketMap.set(marketKey(chainId, market), marketConfig);
  }
}

for (const [chainId, tokens] of Object.entries(gmxTokenConfigs)) {
  for (const [token, tokenConfig] of Object.entries(tokens)) {
    tokenMap.set(marketKey(chainId, token), tokenConfig);
  }
}

/**
 * Adds markets/tokens fetched at runtime on top of the snapshot. Snapshot
 * entries are never replaced. Returns how many entries were new.
 */
export function registerGmxV2Configs(
  chainId: number,
  markets: Record<string, MarketConfig>,
  tokens: Record<string, Token>,
): number {
  let added = 0;

  for (const [address, token] of Object.entries(tokens)) {
    const key = marketKey(chainId, address);

    if (!tokenMap.has(key)) {
      tokenMap.set(key, token);
      syncedTokenKeys.add(key);
      added++;
    }
  }

  for (const [address, market] of Object.entries(markets)) {
    const key = marketKey(chainId, address);

    if (!marketMap.has(key)) {
      marketMap.set(key, market);
      syncedMarketKeys.add(key);
      added++;
    }
  }

  return added;
}

/** Effective markets of a chain (snapshot + synced), keyed by address. */
export function getGmxV2Markets(
  chainId: number,
): Array<{ address: string; market: MarketConfig; source: GmxV2ConfigSource }> {
  const prefix = `${chainId}-`;

  return Array.from(marketMap.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, market]) => ({
      address: market.marketTokenAddress,
      market,
      source: syncedMarketKeys.has(key) ? 'Synced' : 'Snapshot',
    }));
}

/** Effective tokens of a chain (snapshot + synced), keyed by lowercase address. */
export function getGmxV2Tokens(
  chainId: number,
): Array<{ address: string; token: Token; source: GmxV2ConfigSource }> {
  const prefix = `${chainId}-`;

  return Array.from(tokenMap.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, token]) => ({
      address: key.slice(prefix.length),
      token,
      source: syncedTokenKeys.has(key) ? 'Synced' : 'Snapshot',
    }));
}

export function getGmxV2ConfigChainIds(): number[] {
  return Object.keys(gmxMarketConfigs).map(Number);
}

export function getMarketInfo(
  chainId: number,
  market: string,
): MarketConfig | undefined {
  return marketMap.get(marketKey(chainId, market));
}

export function getTokenInfo(
  chainId: number,
  token: string,
): Token | undefined {
  return tokenMap.get(marketKey(chainId, token));
}

export function formatGmxMarketPair(marketInfo: MarketConfig): string {
  return `${marketInfo.indexToken.baseSymbol || marketInfo.indexToken.symbol}/usd`.toLowerCase();
}

/**
 * Name used for a market missing from the config. Raw logs are re-parsed on
 * read, so the real name appears once the market is synced.
 */
export function unknownGmxMarketPair(market: string): string {
  return `market#${market.toLowerCase()}/unknown`;
}

export function resolveGmxMarketPair(chainId: number, market: string): string {
  const marketInfo = getMarketInfo(chainId, market);
  return marketInfo
    ? formatGmxMarketPair(marketInfo)
    : unknownGmxMarketPair(market);
}

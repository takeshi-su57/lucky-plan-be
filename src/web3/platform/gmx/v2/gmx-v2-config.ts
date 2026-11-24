import { zeroAddress } from 'viem';
import * as fs from 'fs';
import * as path from 'path';

import { MarketConfig, Token } from './types';
import { gmxMarketConfigs, gmxTokenConfigs } from './configs';

/** GMX public API host per chain (`https://<host>/markets`, `/tokens`). */
export const gmxV2ApiHosts: Record<number, string> = {
  42161: 'https://arbitrum-api.gmxinfra.io',
  43114: 'https://avalanche-api.gmxinfra.io',
  4326: 'https://megaeth-api.gmxinfra.io',
};

export type GmxApiToken = {
  symbol: string;
  address: string;
  decimals: number;
  synthetic?: boolean;
};

export type GmxApiMarket = {
  name: string;
  marketToken: string;
  indexToken: string;
  longToken: string;
  shortToken: string;
};

export type GmxV2ConfigChainReport = {
  chainId: number;
  markets: number;
  tokens: number;
  addedMarkets: string[];
  addedTokens: string[];
  skippedMarkets: string[];
  error?: string;
};

/** `XAUT (deprecated)` / `APE_deprecated` -> `XAUT` / `APE`. */
export function toGmxBaseSymbol(symbol: string): string {
  return symbol.replace(/\s*\(deprecated\)$/i, '').replace(/_deprecated$/i, '');
}

export function apiTokenToConfig(token: GmxApiToken): Token {
  const baseSymbol = toGmxBaseSymbol(token.symbol);

  return {
    name: token.symbol,
    symbol: token.symbol,
    address: token.address,
    decimals: token.decimals,
    ...(baseSymbol !== token.symbol ? { baseSymbol } : {}),
    ...(token.synthetic ? { isSynthetic: true } : {}),
  };
}

/**
 * Merges GMX's API listing into one chain's snapshot. Existing entries are
 * kept as-is (they carry curated metadata such as images and categories);
 * only markets and tokens the snapshot lacks are added. Swap-only markets
 * (zero index token) are not tradable positions and are skipped.
 */
export function mergeGmxV2Chain(
  existingMarkets: Record<string, MarketConfig>,
  existingTokens: Record<string, Token>,
  apiMarkets: GmxApiMarket[],
  apiTokens: GmxApiToken[],
) {
  const tokens = { ...existingTokens };
  const markets = { ...existingMarkets };
  const knownMarkets = new Set(
    Object.keys(existingMarkets).map((address) => address.toLowerCase()),
  );
  const addedTokens: string[] = [];
  const addedMarkets: string[] = [];
  const skippedMarkets: string[] = [];

  for (const apiToken of apiTokens) {
    const key = apiToken.address.toLowerCase();

    if (!tokens[key]) {
      tokens[key] = apiTokenToConfig(apiToken);
      addedTokens.push(apiToken.symbol);
    }
  }

  for (const apiMarket of apiMarkets) {
    if (
      knownMarkets.has(apiMarket.marketToken.toLowerCase()) ||
      apiMarket.indexToken.toLowerCase() === zeroAddress
    ) {
      continue;
    }

    const indexToken = tokens[apiMarket.indexToken.toLowerCase()];
    const longToken = tokens[apiMarket.longToken.toLowerCase()];
    const shortToken = tokens[apiMarket.shortToken.toLowerCase()];

    if (!indexToken || !longToken || !shortToken) {
      skippedMarkets.push(`${apiMarket.name} (unknown token)`);
      continue;
    }

    markets[apiMarket.marketToken] = {
      marketTokenAddress: apiMarket.marketToken,
      indexTokenAddress: apiMarket.indexToken,
      longTokenAddress: apiMarket.longToken,
      shortTokenAddress: apiMarket.shortToken,
      indexToken,
      longToken,
      shortToken,
    };
    addedMarkets.push(apiMarket.name);
  }

  return { markets, tokens, addedMarkets, addedTokens, skippedMarkets };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });

  if (!response.ok) {
    throw new Error(`${url} -> HTTP ${response.status}`);
  }

  return (await response.json()) as T;
}

/** Current GMX listing for a chain from its public API. */
export async function fetchGmxV2Listing(
  chainId: number,
): Promise<{ markets: GmxApiMarket[]; tokens: GmxApiToken[] }> {
  const host = gmxV2ApiHosts[chainId];

  if (!host) {
    throw new Error(`No GMX API host configured for chain ${chainId}`);
  }

  const [markets, tokens] = await Promise.all([
    fetchJson<{ markets: GmxApiMarket[] }>(`${host}/markets`),
    fetchJson<{ tokens: GmxApiToken[] }>(`${host}/tokens`),
  ]);

  return { markets: markets.markets, tokens: tokens.tokens };
}

/**
 * Regenerates `configs/markets.generated.json` and `tokens.generated.json`.
 * Run with `npm run config:generate:gmx-v2` and commit the diff. A chain
 * whose API fails keeps its previous entries.
 */
export async function generateGmxV2ConfigSnapshot(
  configDir = path.resolve(process.cwd(), 'src/web3/platform/gmx/v2/configs'),
): Promise<GmxV2ConfigChainReport[]> {
  const markets = { ...gmxMarketConfigs };
  const tokens = { ...gmxTokenConfigs };

  const reports = await Promise.all(
    Object.keys(gmxV2ApiHosts).map(async (chainKey) => {
      const chainId = Number(chainKey);
      const report: GmxV2ConfigChainReport = {
        chainId,
        markets: Object.keys(markets[chainKey] ?? {}).length,
        tokens: Object.keys(tokens[chainKey] ?? {}).length,
        addedMarkets: [],
        addedTokens: [],
        skippedMarkets: [],
      };

      try {
        const listing = await fetchGmxV2Listing(chainId);

        const merged = mergeGmxV2Chain(
          markets[chainKey] ?? {},
          tokens[chainKey] ?? {},
          listing.markets,
          listing.tokens,
        );

        markets[chainKey] = merged.markets;
        tokens[chainKey] = merged.tokens;
        report.markets = Object.keys(merged.markets).length;
        report.tokens = Object.keys(merged.tokens).length;
        report.addedMarkets = merged.addedMarkets;
        report.addedTokens = merged.addedTokens;
        report.skippedMarkets = merged.skippedMarkets;
      } catch (error) {
        report.error = error instanceof Error ? error.message : String(error);
      }

      return report;
    }),
  );

  writeJson(path.join(configDir, 'markets.generated.json'), markets);
  writeJson(path.join(configDir, 'tokens.generated.json'), tokens);

  return reports;
}

function writeJson(filePath: string, value: unknown) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

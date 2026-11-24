import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Platform } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';

import {
  PlatformConfigChainReport,
  PlatformConfigMode,
  errorMessage,
} from '../../platform-config.types';
import { savePlatformConfigReport } from '../../platform-config-status';

import {
  formatGmxMarketPair,
  getGmxV2Markets,
  getGmxV2Tokens,
  gmxMarketConfigs,
  gmxTokenConfigs,
  registerGmxV2Configs,
} from './configs';
import {
  fetchGmxV2Listing,
  gmxV2ApiHosts,
  mergeGmxV2Chain,
} from './gmx-v2-config';
import { MarketConfig, Token } from './types';

/** Metadata rows holding markets/tokens added on top of the snapshot. */
export const GMX_V2_METADATA_PREFIX = 'gmx.v2.config.';

const RELOAD_INTERVAL_MS = 5 * 60_000;
const AUTO_SYNC_INTERVAL_MS = 30 * 60_000;

const NETWORKS: Record<number, string> = {
  42161: 'Arbitrum',
  43114: 'Avalanche',
  4326: 'MegaETH',
};

type GmxV2Overlay = {
  markets: Record<string, MarketConfig>;
  tokens: Record<string, Token>;
};

export type GmxMarketConfigItem = {
  address: string;
  pair: string;
  indexSymbol: string;
  indexDecimals: number;
  longSymbol: string;
  shortSymbol: string;
  synced: boolean;
};

export type GmxTokenConfigItem = {
  address: string;
  symbol: string;
  decimals: number;
  synthetic: boolean;
  synced: boolean;
};

/**
 * Keeps GMX V2 markets/tokens current between snapshot regenerations.
 *
 * GMX token metadata is not on-chain, so the source is GMX's public API. New
 * entries are stored in Metadata and applied by every process on reload;
 * snapshot entries are never replaced (they carry curated metadata), only
 * reported when the API disagrees on decimals.
 */
@Injectable()
export class GmxV2ConfigSyncService implements OnModuleInit {
  private running: Promise<PlatformConfigChainReport[]> | null = null;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  async onModuleInit() {
    await this.reloadFromDb();
    void this.autoSync();
  }

  @Interval(RELOAD_INTERVAL_MS)
  async handleReload() {
    await this.reloadFromDb();
  }

  @Interval(AUTO_SYNC_INTERVAL_MS)
  async handleAutoSync() {
    await this.autoSync();
  }

  getChains(): Array<{ chainId: number; network: string }> {
    return Object.keys(gmxV2ApiHosts).map((key) => ({
      chainId: Number(key),
      network: NETWORKS[Number(key)] ?? `Chain ${key}`,
    }));
  }

  getMarketItems(chainId: number): GmxMarketConfigItem[] {
    return getGmxV2Markets(chainId).map(({ address, market, source }) => ({
      address,
      pair: formatGmxMarketPair(market),
      indexSymbol: market.indexToken.symbol,
      indexDecimals: market.indexToken.decimals,
      longSymbol: market.longToken.symbol,
      shortSymbol: market.shortToken.symbol,
      synced: source === 'Synced',
    }));
  }

  getTokenItems(chainId: number): GmxTokenConfigItem[] {
    return getGmxV2Tokens(chainId).map(({ address, token, source }) => ({
      address,
      symbol: token.symbol,
      decimals: token.decimals,
      synthetic: !!token.isSynthetic,
      synced: source === 'Synced',
    }));
  }

  getSnapshotCounts(chainId: number) {
    return {
      markets: Object.keys(gmxMarketConfigs[chainId] ?? {}).length,
      tokens: Object.keys(gmxTokenConfigs[chainId] ?? {}).length,
    };
  }

  getEffectiveCounts(chainId: number) {
    return {
      markets: getGmxV2Markets(chainId).length,
      tokens: getGmxV2Tokens(chainId).length,
    };
  }

  check(chainId?: number): Promise<PlatformConfigChainReport[]> {
    return this.runForChains('check', chainId);
  }

  sync(chainId?: number): Promise<PlatformConfigChainReport[]> {
    if (!this.running) {
      this.running = this.runForChains('sync', chainId).finally(() => {
        this.running = null;
      });
    }

    return this.running;
  }

  async reloadFromDb() {
    try {
      const rows = await this.prismaService.metadata.findMany({
        where: { key: { startsWith: GMX_V2_METADATA_PREFIX } },
      });

      for (const row of rows) {
        const chainId = Number(row.key.slice(GMX_V2_METADATA_PREFIX.length));
        const overlay = JSON.parse(row.value) as GmxV2Overlay;

        if (Number.isInteger(chainId) && overlay?.markets && overlay?.tokens) {
          registerGmxV2Configs(chainId, overlay.markets, overlay.tokens);
        }
      }
    } catch (error) {
      this.logger.nativeLog({
        severity: 'Warning',
        summary: 'GmxV2ConfigSyncService>reloadFromDb',
        details: errorMessage(error),
      });
    }
  }

  private async autoSync() {
    const reports = await this.runForChains('sync', undefined, false);

    for (const report of reports) {
      if (report.error || report.applied.length > 0) {
        this.logger.nativeLog({
          severity: report.error ? 'Warning' : 'Info',
          summary: 'GmxV2ConfigSyncService>autoSync',
          details: `chain ${report.chainId}: ${
            report.error ?? report.applied.join(', ')
          }`,
        });
      }
    }
  }

  private async runForChains(
    mode: PlatformConfigMode,
    onlyChainId?: number,
    saveStatus = true,
  ): Promise<PlatformConfigChainReport[]> {
    await this.reloadFromDb();

    const chains = this.getChains().filter(
      ({ chainId }) => onlyChainId === undefined || chainId === onlyChainId,
    );
    const reports = await Promise.all(
      chains.map(({ chainId }) => this.runChain(mode, chainId)),
    );

    if (saveStatus) {
      for (const report of reports) {
        await savePlatformConfigReport(this.prismaService, report);
      }
    }

    return reports;
  }

  private async runChain(
    mode: PlatformConfigMode,
    chainId: number,
  ): Promise<PlatformConfigChainReport> {
    const report: PlatformConfigChainReport = {
      platform: Platform.GMX,
      chainId,
      network: NETWORKS[chainId] ?? `Chain ${chainId}`,
      mode,
      sourceCount: 0,
      effectiveCount: getGmxV2Markets(chainId).length,
      missing: [],
      changed: [],
      applied: [],
      error: null,
      finishedAt: 0,
    };

    try {
      const listing = await fetchGmxV2Listing(chainId);
      const knownMarkets = Object.fromEntries(
        getGmxV2Markets(chainId).map(({ address, market }) => [
          address,
          market,
        ]),
      );
      const knownTokens = Object.fromEntries(
        getGmxV2Tokens(chainId).map(({ address, token }) => [address, token]),
      );

      const merged = mergeGmxV2Chain(
        knownMarkets,
        knownTokens,
        listing.markets,
        listing.tokens,
      );

      report.sourceCount = listing.markets.filter(
        (market) => !/^0x0+$/.test(market.indexToken),
      ).length;
      report.missing = [
        ...merged.addedMarkets.map((name) => `market ${name}`),
        ...merged.addedTokens.map((symbol) => `token ${symbol}`),
        ...merged.skippedMarkets.map((name) => `market ${name}`),
      ];

      for (const apiToken of listing.tokens) {
        const known = knownTokens[apiToken.address.toLowerCase()];

        if (known && known.decimals !== apiToken.decimals) {
          report.changed.push(
            `token ${apiToken.symbol} decimals ${known.decimals} -> ${apiToken.decimals}`,
          );
        }
      }

      if (mode === 'sync') {
        const newMarkets = Object.fromEntries(
          Object.entries(merged.markets).filter(
            ([address]) => !knownMarkets[address],
          ),
        );
        const newTokens = Object.fromEntries(
          Object.entries(merged.tokens).filter(
            ([address]) => !knownTokens[address],
          ),
        );

        if (registerGmxV2Configs(chainId, newMarkets, newTokens) > 0) {
          await this.persist(chainId);
          report.applied = [
            ...merged.addedMarkets.map((name) => `market ${name}`),
            ...merged.addedTokens.map((symbol) => `token ${symbol}`),
          ];
        }
      }

      report.effectiveCount = getGmxV2Markets(chainId).length;
    } catch (error) {
      report.error = errorMessage(error);
    }

    report.finishedAt = Date.now();
    return report;
  }

  private async persist(chainId: number) {
    const overlay: GmxV2Overlay = {
      markets: Object.fromEntries(
        getGmxV2Markets(chainId)
          .filter(({ source }) => source === 'Synced')
          .map(({ address, market }) => [address, market]),
      ),
      tokens: Object.fromEntries(
        getGmxV2Tokens(chainId)
          .filter(({ source }) => source === 'Synced')
          .map(({ address, token }) => [address, token]),
      ),
    };
    const key = `${GMX_V2_METADATA_PREFIX}${chainId}`;
    const value = JSON.stringify(overlay);

    await this.prismaService.metadata.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

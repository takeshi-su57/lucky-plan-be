import { BadRequestException, Injectable } from '@nestjs/common';
import { Platform } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { GnsConfigSyncService } from 'src/web3/platform/gns/gns-config-sync.service';
import { GmxV2ConfigSyncService } from 'src/web3/platform/gmx/v2/gmx-v2-config-sync.service';
import { AvntConfigSyncService } from 'src/web3/platform/avnt/avnt-config-sync.service';
import { loadPlatformConfigStatuses } from 'src/web3/platform/platform-config-status';
import {
  PlatformConfigChainReport,
  platformConfigStatusKey,
} from 'src/web3/platform/platform-config.types';

import {
  PlatformConfigChain,
  PlatformConfigDashboard,
  PlatformConfigItem,
} from './entities/platform-config.entity';

@Injectable()
export class PlatformConfigsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly gnsConfigSync: GnsConfigSyncService,
    private readonly gmxV2ConfigSync: GmxV2ConfigSyncService,
    private readonly avntConfigSync: AvntConfigSyncService,
  ) {}

  async getDashboard(): Promise<PlatformConfigDashboard> {
    // Pick up overlays other processes wrote since the last reload.
    await Promise.all([
      this.gnsConfigSync.reloadFromDb(),
      this.gmxV2ConfigSync.reloadFromDb(),
      this.avntConfigSync.reloadFromDb(),
    ]);

    const statuses = await loadPlatformConfigStatuses(this.prismaService);
    const status = (platform: Platform, chainId: number) =>
      statuses.get(platformConfigStatusKey(platform, chainId)) ?? {};

    const gnsChains: PlatformConfigChain[] = (
      await this.gnsConfigSync.getChains()
    ).map(({ chainId, network }) => {
      const snapshot = this.gnsConfigSync.getSnapshotCounts(chainId);
      const effective = this.gnsConfigSync.getEffectiveCounts(chainId);
      const { lastCheck, lastSync } = status(Platform.GNS, chainId);

      return {
        platform: Platform.GNS,
        chainId,
        network,
        itemLabel: 'pairs',
        snapshotCount: snapshot.pairs,
        effectiveCount: effective.pairs,
        secondaryLabel: 'collaterals',
        secondarySnapshotCount: snapshot.collaterals,
        secondaryEffectiveCount: effective.collaterals,
        lastCheck: lastCheck ?? null,
        lastSync: lastSync ?? null,
      };
    });

    const gmxChains: PlatformConfigChain[] = this.gmxV2ConfigSync
      .getChains()
      .map(({ chainId, network }) => {
        const snapshot = this.gmxV2ConfigSync.getSnapshotCounts(chainId);
        const effective = this.gmxV2ConfigSync.getEffectiveCounts(chainId);
        const { lastCheck, lastSync } = status(Platform.GMX, chainId);

        return {
          platform: Platform.GMX,
          chainId,
          network,
          itemLabel: 'markets',
          snapshotCount: snapshot.markets,
          effectiveCount: effective.markets,
          secondaryLabel: 'tokens',
          secondarySnapshotCount: snapshot.tokens,
          secondaryEffectiveCount: effective.tokens,
          lastCheck: lastCheck ?? null,
          lastSync: lastSync ?? null,
        };
      });

    const avntChains: PlatformConfigChain[] = this.avntConfigSync
      .getChains()
      .map(({ chainId, network }) => {
        const { lastCheck, lastSync } = status(Platform.AVNT, chainId);

        return {
          platform: Platform.AVNT,
          chainId,
          network,
          itemLabel: 'pairs',
          snapshotCount: this.avntConfigSync.getSnapshotCount(),
          effectiveCount: this.avntConfigSync.getEffectiveCount(),
          secondaryLabel: 'collaterals',
          // Avantis settles in USDC only; there is no collateral table.
          secondarySnapshotCount: 1,
          secondaryEffectiveCount: 1,
          lastCheck: lastCheck ?? null,
          lastSync: lastSync ?? null,
        };
      });

    return {
      chains: [...gnsChains, ...gmxChains, ...avntChains],
      generatedAt: Date.now(),
    };
  }

  async getItems(
    platform: Platform,
    chainId: number,
  ): Promise<PlatformConfigItem[]> {
    if (platform === Platform.GNS) {
      await this.gnsConfigSync.reloadFromDb();

      return [
        ...this.gnsConfigSync.getPairItems(chainId).map((pair) => ({
          kind: 'pair',
          key: String(pair.pairIndex),
          name: pair.name,
          detail: `group ${pair.groupIndex} · fee ${pair.feeIndex}`,
          synced: pair.synced,
        })),
        ...this.gnsConfigSync.getCollateralItems(chainId).map((item) => ({
          kind: 'collateral',
          key: String(item.collateralIndex),
          name: item.address,
          detail: `${item.isActive ? 'active' : 'inactive'} · precision ${item.precision}`,
          synced: item.synced,
        })),
      ];
    }

    if (platform === Platform.GMX) {
      await this.gmxV2ConfigSync.reloadFromDb();

      return [
        ...this.gmxV2ConfigSync.getMarketItems(chainId).map((market) => ({
          kind: 'market',
          key: market.address,
          name: market.pair,
          detail: `${market.indexSymbol} (${market.indexDecimals}d) [${market.longSymbol}-${market.shortSymbol}]`,
          synced: market.synced,
        })),
        ...this.gmxV2ConfigSync.getTokenItems(chainId).map((token) => ({
          kind: 'token',
          key: token.address,
          name: token.symbol,
          detail: `${token.decimals} decimals${token.synthetic ? ' · synthetic' : ''}`,
          synced: token.synced,
        })),
      ];
    }

    if (platform === Platform.AVNT) {
      await this.avntConfigSync.reloadFromDb();

      return this.avntConfigSync.getPairItems().map((pair) => ({
        kind: 'pair',
        key: String(pair.pairIndex),
        name: pair.name,
        detail: `${pair.numTiers} tier${pair.numTiers === '1' ? '' : 's'}`,
        synced: pair.synced,
      }));
    }

    throw new BadRequestException(`No config sync for ${platform}`);
  }

  check(
    platform: Platform,
    chainId?: number | null,
  ): Promise<PlatformConfigChainReport[]> {
    return this.syncer(platform).check(chainId ?? undefined);
  }

  sync(
    platform: Platform,
    chainId?: number | null,
  ): Promise<PlatformConfigChainReport[]> {
    return this.syncer(platform).sync(chainId ?? undefined);
  }

  private syncer(platform: Platform) {
    if (platform === Platform.GNS) {
      return this.gnsConfigSync;
    }

    if (platform === Platform.GMX) {
      return this.gmxV2ConfigSync;
    }

    if (platform === Platform.AVNT) {
      return this.avntConfigSync;
    }

    throw new BadRequestException(`No config sync for ${platform}`);
  }
}

import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Platform } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { EvmChainsService } from 'src/web3/web3/evm-chains.service';

import {
  PlatformConfigChainReport,
  PlatformConfigMode,
  errorMessage,
} from '../platform-config.types';
import { savePlatformConfigReport } from '../platform-config-status';

import { readAvntPairs, readAvntPairsCount } from './avnt-chain-reader';
import {
  AVNT_CHAIN_ID,
  avntPairsSnapshot,
  formatAvntPairName,
  getAvntKnownPairCount,
  getAvntPairs,
  getPair,
  preserveRetiredAvntNames,
  registerAvntPairs,
} from './v1/configs';
import { Pair } from './v1/types';

/** Metadata row holding pairs that differ from / extend the snapshot. */
export const AVNT_PAIRS_METADATA_KEY = `avnt.pairs.${AVNT_CHAIN_ID}`;

const RELOAD_INTERVAL_MS = 5 * 60_000;
const AUTO_SYNC_INTERVAL_MS = 30 * 60_000;

export type AvntPairConfigItem = {
  pairIndex: number;
  name: string;
  numTiers: string;
  synced: boolean;
};

const pairLabel = (pair: Pair) =>
  `#${pair.pairIndex} ${formatAvntPairName(pair)}`;

const isSnapshotPair = (pair: Pair) => {
  const snapshot = avntPairsSnapshot[pair.pairIndex];
  return (
    !!snapshot && formatAvntPairName(snapshot) === formatAvntPairName(pair)
  );
};

/**
 * Keeps the Avantis pair table in step with PairStorage on Base.
 *
 * Same model as GNS: the committed snapshot is the baseline, pairs listed
 * later are stored in Metadata and applied by every process on reload, and
 * the admin dashboard can check or sync on demand. Background runs only fetch
 * new indexes; a dashboard sync re-reads every pair to catch renames.
 */
@Injectable()
export class AvntConfigSyncService implements OnModuleInit {
  private running: Promise<PlatformConfigChainReport[]> | null = null;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly chainsService: EvmChainsService,
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
    return [{ chainId: AVNT_CHAIN_ID, network: 'Base' }];
  }

  getPairItems(): AvntPairConfigItem[] {
    return getAvntPairs().map((pair) => ({
      pairIndex: pair.pairIndex,
      name: formatAvntPairName(pair),
      numTiers: pair.numTiers,
      synced: !isSnapshotPair(pair),
    }));
  }

  getSnapshotCount() {
    return avntPairsSnapshot.length;
  }

  getEffectiveCount() {
    return getAvntKnownPairCount();
  }

  check(chainId?: number): Promise<PlatformConfigChainReport[]> {
    return this.run('check', chainId);
  }

  sync(chainId?: number): Promise<PlatformConfigChainReport[]> {
    if (!this.running) {
      this.running = this.run('sync', chainId).finally(() => {
        this.running = null;
      });
    }

    return this.running;
  }

  async reloadFromDb() {
    try {
      const row = await this.prismaService.metadata.findUnique({
        where: { key: AVNT_PAIRS_METADATA_KEY },
      });

      if (row) {
        const pairs = JSON.parse(row.value) as Pair[];

        if (Array.isArray(pairs)) {
          registerAvntPairs(pairs);
        }
      }
    } catch (error) {
      this.logger.nativeLog({
        severity: 'Warning',
        summary: 'AvntConfigSyncService>reloadFromDb',
        details: errorMessage(error),
      });
    }
  }

  private async autoSync() {
    await this.reloadFromDb();

    try {
      const pairsCount = await readAvntPairsCount(this.chainsService);
      const knownCount = getAvntKnownPairCount();

      if (pairsCount <= knownCount) {
        return;
      }

      const newPairs = await readAvntPairs(
        this.chainsService,
        knownCount,
        pairsCount,
      );
      const applied = await this.apply(newPairs);

      this.logger.nativeLog({
        severity: 'Info',
        summary: 'AvntConfigSyncService>autoSync',
        details: `added ${applied.join(', ')}`,
      });
    } catch (error) {
      this.logger.nativeLog({
        severity: 'Warning',
        summary: 'AvntConfigSyncService>autoSync',
        details: errorMessage(error),
      });
    }
  }

  private async run(
    mode: PlatformConfigMode,
    chainId?: number,
  ): Promise<PlatformConfigChainReport[]> {
    if (chainId !== undefined && chainId !== AVNT_CHAIN_ID) {
      return [];
    }

    await this.reloadFromDb();

    const report: PlatformConfigChainReport = {
      platform: Platform.AVNT,
      chainId: AVNT_CHAIN_ID,
      network: 'Base',
      mode,
      sourceCount: 0,
      effectiveCount: getAvntKnownPairCount(),
      missing: [],
      changed: [],
      applied: [],
      error: null,
      finishedAt: 0,
    };

    try {
      const pairsCount = await readAvntPairsCount(this.chainsService);
      const pairs = preserveRetiredAvntNames(
        await readAvntPairs(this.chainsService, 0, pairsCount),
        getPair,
      );

      report.sourceCount = pairs.length;

      for (const pair of pairs) {
        const known = getPair(pair.pairIndex);

        if (!known) {
          report.missing.push(pairLabel(pair));
        } else if (formatAvntPairName(known) !== formatAvntPairName(pair)) {
          report.changed.push(
            `${pairLabel(known)} -> ${formatAvntPairName(pair)}`,
          );
        }
      }

      if (mode === 'sync') {
        report.applied = await this.apply(pairs);
      }

      report.effectiveCount = getAvntKnownPairCount();
    } catch (error) {
      report.error = errorMessage(error);
    }

    report.finishedAt = Date.now();
    await savePlatformConfigReport(this.prismaService, report);

    return [report];
  }

  /** Registers chain pairs and persists the overlay. Returns what changed. */
  private async apply(pairs: Pair[]): Promise<string[]> {
    const applied = pairs
      .filter((pair) => {
        const known = getPair(pair.pairIndex);
        return !known || formatAvntPairName(known) !== formatAvntPairName(pair);
      })
      .map(pairLabel);

    if (applied.length === 0) {
      return [];
    }

    registerAvntPairs(pairs);

    const value = JSON.stringify(
      getAvntPairs().filter((pair) => !isSnapshotPair(pair)),
    );

    await this.prismaService.metadata.upsert({
      where: { key: AVNT_PAIRS_METADATA_KEY },
      create: { key: AVNT_PAIRS_METADATA_KEY, value },
      update: { value },
    });

    return applied;
  }
}

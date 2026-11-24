import { Injectable, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Address } from 'viem';
import { Platform, Version } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { EvmChainsService } from 'src/web3/web3/evm-chains.service';

import {
  PlatformConfigChainReport,
  PlatformConfigMode,
  errorMessage,
} from '../platform-config.types';
import { savePlatformConfigReport } from '../platform-config-status';

import {
  SerializedGnsCollateral,
  SerializedGnsPair,
  deserializeGnsCollateral,
  deserializeGnsPair,
  gnsCollateralsSnapshot,
  gnsDiamondDeployments,
  gnsPairsSnapshot,
  serializeGnsCollateral,
  serializeGnsPair,
} from './configs';
import {
  readGnsCollaterals,
  readGnsPairs,
  readGnsPairsCount,
} from './gns-chain-reader';
import { formatGnsPairName, gnsPairRegistry } from './pair-registry';
import { getCollaterals, setCollaterals } from './v10/configs';
import { Collateral, Pair } from './v10/types';

/** Metadata rows holding pairs that differ from / extend the snapshot. */
export const GNS_PAIRS_METADATA_PREFIX = 'gns.pairs.';
/** Metadata rows holding a chain's full collateral list when it differs. */
export const GNS_COLLATERALS_METADATA_PREFIX = 'gns.collaterals.';

const RELOAD_INTERVAL_MS = 5 * 60_000;
const AUTO_SYNC_INTERVAL_MS = 30 * 60_000;

export type GnsPairConfigItem = {
  pairIndex: number;
  name: string;
  groupIndex: number;
  feeIndex: number;
  synced: boolean;
};

export type GnsCollateralConfigItem = {
  collateralIndex: number;
  address: string;
  isActive: boolean;
  precision: string;
  synced: boolean;
};

const pairLabel = (pair: Pick<Pair, 'pairIndex' | 'from' | 'to'>) =>
  `#${pair.pairIndex} ${formatGnsPairName(pair)}`;

const collateralLabel = (collateral: Collateral) =>
  `collateral #${collateral.collateralIndex} ${collateral.collateral}${
    collateral.isActive ? '' : ' (inactive)'
  }`;

function sameCollateral(a: Collateral, b: Collateral) {
  return (
    a.collateral.toLowerCase() === b.collateral.toLowerCase() &&
    a.isActive === b.isActive &&
    a.precision === b.precision
  );
}

function snapshotPair(chainId: number, pairIndex: number) {
  return gnsPairsSnapshot[chainId]?.[pairIndex];
}

/**
 * Keeps the GNS pair registry and collateral table in step with chain.
 *
 * The committed snapshot (`configs/*.generated.json`) is the baseline. What
 * chain has on top of it is stored in Metadata, so every process (api,
 * analytics, copy-trading) applies the same overlay on its next reload, and
 * the admin dashboard can check or sync it on demand. Background runs are
 * incremental (pairsCount + new indexes + collaterals); a dashboard sync
 * re-reads every pair so renames are picked up too.
 */
@Injectable()
export class GnsConfigSyncService implements OnModuleInit {
  private running: Promise<PlatformConfigChainReport[]> | null = null;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly contractsService: ContractsService,
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

  /** Chains with a V10 diamond, for the dashboard. */
  async getChains(): Promise<Array<{ chainId: number; network: string }>> {
    const diamonds = await this.getDiamonds();
    return Array.from(diamonds.keys()).map((chainId) => ({
      chainId,
      network: networkName(chainId),
    }));
  }

  getPairItems(chainId: number): GnsPairConfigItem[] {
    return gnsPairRegistry.pairsFrom(chainId, 0).map((pair) => {
      const snapshot = snapshotPair(chainId, pair.pairIndex);

      return {
        pairIndex: pair.pairIndex,
        name: formatGnsPairName(pair),
        groupIndex: Number(pair.groupIndex),
        feeIndex: Number(pair.feeIndex),
        synced:
          !snapshot || formatGnsPairName(snapshot) !== formatGnsPairName(pair),
      };
    });
  }

  getCollateralItems(chainId: number): GnsCollateralConfigItem[] {
    const snapshot = (gnsCollateralsSnapshot[chainId] ?? []).map(
      deserializeGnsCollateral,
    );

    return getCollaterals(chainId).map((collateral) => {
      const base = snapshot[collateral.collateralIndex - 1];

      return {
        collateralIndex: collateral.collateralIndex,
        address: collateral.collateral,
        isActive: collateral.isActive,
        precision: collateral.precision.toString(),
        synced: !base || !sameCollateral(base, collateral),
      };
    });
  }

  getSnapshotCounts(chainId: number) {
    return {
      pairs: gnsPairsSnapshot[chainId]?.length ?? 0,
      collaterals: gnsCollateralsSnapshot[chainId]?.length ?? 0,
    };
  }

  getEffectiveCounts(chainId: number) {
    return {
      pairs: gnsPairRegistry.knownCount(chainId),
      collaterals: getCollaterals(chainId).length,
    };
  }

  /** Compares chain with the live config. Read-only. */
  check(chainId?: number): Promise<PlatformConfigChainReport[]> {
    return this.runForChains('check', chainId);
  }

  /** Reads every pair and collateral and applies the differences. */
  sync(chainId?: number): Promise<PlatformConfigChainReport[]> {
    if (!this.running) {
      this.running = this.runForChains('sync', chainId).finally(() => {
        this.running = null;
      });
    }

    return this.running;
  }

  /** Loads the overlay other processes (or the dashboard) wrote. */
  async reloadFromDb() {
    try {
      const rows = await this.prismaService.metadata.findMany({
        where: {
          OR: [
            { key: { startsWith: GNS_PAIRS_METADATA_PREFIX } },
            { key: { startsWith: GNS_COLLATERALS_METADATA_PREFIX } },
          ],
        },
      });

      for (const row of rows) {
        if (row.key.startsWith(GNS_PAIRS_METADATA_PREFIX)) {
          const chainId = Number(
            row.key.slice(GNS_PAIRS_METADATA_PREFIX.length),
          );
          const pairs = JSON.parse(row.value) as SerializedGnsPair[];

          if (Number.isInteger(chainId) && Array.isArray(pairs)) {
            gnsPairRegistry.register(chainId, pairs.map(deserializeGnsPair));
          }
        } else {
          const chainId = Number(
            row.key.slice(GNS_COLLATERALS_METADATA_PREFIX.length),
          );
          const collaterals = JSON.parse(
            row.value,
          ) as SerializedGnsCollateral[];

          if (Number.isInteger(chainId) && Array.isArray(collaterals)) {
            setCollaterals(chainId, collaterals.map(deserializeGnsCollateral));
          }
        }
      }
    } catch (error) {
      this.logger.nativeLog({
        severity: 'Warning',
        summary: 'GnsConfigSyncService>reloadFromDb',
        details: errorMessage(error),
      });
    }
  }

  /** Background run: only new pair indexes plus the collateral list. */
  private async autoSync() {
    await this.reloadFromDb();

    for (const [chainId, address] of await this.getDiamonds()) {
      try {
        const pairsCount = await readGnsPairsCount(
          this.chainsService,
          chainId,
          address,
        );
        const knownCount = gnsPairRegistry.knownCount(chainId);
        const newPairs =
          pairsCount > knownCount
            ? await readGnsPairs(
                this.chainsService,
                chainId,
                address,
                knownCount,
                pairsCount,
              )
            : [];
        const collaterals = await readGnsCollaterals(
          this.chainsService,
          chainId,
          address,
        );
        const applied = await this.apply(chainId, newPairs, collaterals);

        if (applied.length > 0) {
          this.logger.nativeLog({
            severity: 'Info',
            summary: 'GnsConfigSyncService>autoSync',
            details: `chain ${chainId}: ${applied.join(', ')}`,
          });
        }
      } catch (error) {
        this.logger.nativeLog({
          severity: 'Warning',
          summary: 'GnsConfigSyncService>autoSync',
          details: `chain ${chainId}: ${errorMessage(error)}`,
        });
      }
    }
  }

  private async runForChains(
    mode: PlatformConfigMode,
    onlyChainId?: number,
  ): Promise<PlatformConfigChainReport[]> {
    // Compare against what other processes already applied, not a stale copy.
    await this.reloadFromDb();

    const diamonds = Array.from((await this.getDiamonds()).entries()).filter(
      ([chainId]) => onlyChainId === undefined || chainId === onlyChainId,
    );

    const reports = await Promise.all(
      diamonds.map(([chainId, address]) =>
        this.runChain(mode, chainId, address),
      ),
    );

    for (const report of reports) {
      await savePlatformConfigReport(this.prismaService, report);
    }

    return reports;
  }

  private async runChain(
    mode: PlatformConfigMode,
    chainId: number,
    address: Address,
  ): Promise<PlatformConfigChainReport> {
    const report: PlatformConfigChainReport = {
      platform: Platform.GNS,
      chainId,
      network: networkName(chainId),
      mode,
      sourceCount: 0,
      effectiveCount: gnsPairRegistry.knownCount(chainId),
      missing: [],
      changed: [],
      applied: [],
      error: null,
      finishedAt: 0,
    };

    try {
      const pairsCount = await readGnsPairsCount(
        this.chainsService,
        chainId,
        address,
      );
      const [pairs, collaterals] = await Promise.all([
        readGnsPairs(this.chainsService, chainId, address, 0, pairsCount),
        readGnsCollaterals(this.chainsService, chainId, address),
      ]);

      report.sourceCount = pairs.length;

      for (const pair of pairs) {
        const known = gnsPairRegistry.get(chainId, pair.pairIndex);

        if (!known) {
          report.missing.push(pairLabel(pair));
        } else if (formatGnsPairName(known) !== formatGnsPairName(pair)) {
          report.changed.push(
            `${pairLabel(known)} -> ${formatGnsPairName(pair)}`,
          );
        }
      }

      const knownCollaterals = getCollaterals(chainId);

      for (const collateral of collaterals) {
        const known = knownCollaterals[collateral.collateralIndex - 1];

        if (!known) {
          report.missing.push(collateralLabel(collateral));
        } else if (!sameCollateral(known, collateral)) {
          report.changed.push(
            `${collateralLabel(known)} -> ${collateralLabel(collateral)}`,
          );
        }
      }

      if (mode === 'sync') {
        report.applied = await this.apply(chainId, pairs, collaterals);
      }

      report.effectiveCount = gnsPairRegistry.knownCount(chainId);
    } catch (error) {
      report.error = errorMessage(error);
    }

    report.finishedAt = Date.now();
    return report;
  }

  /** Registers chain data and persists the overlay. Returns what changed. */
  private async apply(
    chainId: number,
    pairs: Pair[],
    collaterals: Collateral[],
  ): Promise<string[]> {
    const applied: string[] = [];

    for (const pair of pairs) {
      const known = gnsPairRegistry.get(chainId, pair.pairIndex);

      if (!known || formatGnsPairName(known) !== formatGnsPairName(pair)) {
        applied.push(pairLabel(pair));
      }
    }

    if (applied.length > 0) {
      gnsPairRegistry.register(chainId, pairs);
      await this.persistPairs(chainId);
    }

    const knownCollaterals = getCollaterals(chainId);
    const collateralsChanged =
      collaterals.length !== knownCollaterals.length ||
      collaterals.some(
        (collateral, index) =>
          !knownCollaterals[index] ||
          !sameCollateral(knownCollaterals[index], collateral),
      );

    if (collateralsChanged && collaterals.length >= knownCollaterals.length) {
      setCollaterals(chainId, collaterals);
      await this.upsert(
        `${GNS_COLLATERALS_METADATA_PREFIX}${chainId}`,
        JSON.stringify(collaterals.map(serializeGnsCollateral)),
      );
      applied.push(
        `collaterals (${collaterals.map(collateralLabel).join(', ')})`,
      );
    }

    return applied;
  }

  /** Persists every pair that is new or renamed relative to the snapshot. */
  private async persistPairs(chainId: number) {
    const overlay = gnsPairRegistry.pairsFrom(chainId, 0).filter((pair) => {
      const snapshot = snapshotPair(chainId, pair.pairIndex);
      return (
        !snapshot || formatGnsPairName(snapshot) !== formatGnsPairName(pair)
      );
    });

    await this.upsert(
      `${GNS_PAIRS_METADATA_PREFIX}${chainId}`,
      JSON.stringify(overlay.map(serializeGnsPair)),
    );
  }

  private async upsert(key: string, value: string) {
    await this.prismaService.metadata.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  private async getDiamonds(): Promise<Map<number, Address>> {
    const contracts = await this.contractsService.findAll();
    const diamonds = new Map<number, Address>();

    for (const contract of contracts) {
      if (
        contract.platform === Platform.GNS &&
        contract.version === Version.V10
      ) {
        diamonds.set(contract.chainId, contract.address as Address);
      }
    }

    return diamonds;
  }
}

function networkName(chainId: number): string {
  return (
    gnsDiamondDeployments.find((deployment) => deployment.chainId === chainId)
      ?.network ?? `Chain ${chainId}`
  );
}

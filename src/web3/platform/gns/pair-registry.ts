import type { Pair } from './v10/types';
import { deserializeGnsPair, gnsPairsSnapshot } from './configs';

/**
 * Single source of truth for GNS pair metadata, shared by every contract
 * version (v6-v10). GNS pair indexes are append-only and identical across
 * diamond upgrades, so one table per chain covers all versions.
 *
 * The table is seeded from the committed snapshot
 * (`configs/pairs.generated.json`, regenerated with
 * `npm run config:generate:gns`) and topped up at runtime by
 * `GnsConfigSyncService` with pairs listed after the snapshot was taken. Lookups stay synchronous so the
 * event parsers can keep their pure, synchronous signatures.
 */
export class GnsPairRegistry {
  private readonly pairsByChain = new Map<number, Map<number, Pair>>();
  private readonly pairsByName = new Map<number, Map<string, Pair>>();

  /** Adds or replaces pairs. Returns how many entries were new or changed. */
  register(chainId: number, pairs: Pair[]): number {
    let byIndex = this.pairsByChain.get(chainId);
    let byName = this.pairsByName.get(chainId);

    if (!byIndex || !byName) {
      byIndex = new Map();
      byName = new Map();
      this.pairsByChain.set(chainId, byIndex);
      this.pairsByName.set(chainId, byName);
    }

    let changed = 0;

    for (const pair of pairs) {
      const existing = byIndex.get(pair.pairIndex);

      if (existing && formatGnsPairName(existing) === formatGnsPairName(pair)) {
        continue;
      }

      if (existing) {
        byName.delete(formatGnsPairName(existing));
      }

      byIndex.set(pair.pairIndex, pair);
      byName.set(formatGnsPairName(pair), pair);
      changed++;
    }

    return changed;
  }

  hasChain(chainId: number): boolean {
    return this.pairsByChain.has(chainId);
  }

  chainIds(): number[] {
    return Array.from(this.pairsByChain.keys());
  }

  /**
   * Number of contiguous pairs known from index 0. New pairs on-chain start
   * at this index, so it is where a sync should resume.
   */
  knownCount(chainId: number): number {
    const byIndex = this.pairsByChain.get(chainId);

    if (!byIndex) {
      return 0;
    }

    let count = 0;

    while (byIndex.has(count)) {
      count++;
    }

    return count;
  }

  /** Registered pairs with `pairIndex >= startIndex`, ordered by index. */
  pairsFrom(chainId: number, startIndex: number): Pair[] {
    return Array.from(this.pairsByChain.get(chainId)?.values() ?? [])
      .filter((pair) => pair.pairIndex >= startIndex)
      .sort((a, b) => a.pairIndex - b.pairIndex);
  }

  get(chainId: number, pairIndex: number): Pair | null {
    return this.pairsByChain.get(chainId)?.get(pairIndex) ?? null;
  }

  getByName(chainId: number, pairName: string): Pair | null {
    return this.pairsByName.get(chainId)?.get(pairName.toLowerCase()) ?? null;
  }
}

export function formatGnsPairName(pair: Pick<Pair, 'from' | 'to'>): string {
  return `${pair.from}/${pair.to}`.toLowerCase();
}

/**
 * Name used for a pair the registry does not know yet. Parsers return it
 * instead of dropping the event so the raw log is still stored; stored logs
 * are re-parsed on read, so the real name shows up once the pair is synced.
 */
export function unknownGnsPairName(pairIndex: number): string {
  return `pair#${pairIndex}/unknown`;
}

export function isUnknownGnsPairName(pairName: string): boolean {
  return /^pair#\d+\/unknown$/.test(pairName);
}

function seedFromSnapshot(registry: GnsPairRegistry) {
  for (const [chainId, pairs] of Object.entries(gnsPairsSnapshot)) {
    registry.register(Number(chainId), pairs.map(deserializeGnsPair));
  }
}

export const gnsPairRegistry = new GnsPairRegistry();

seedFromSnapshot(gnsPairRegistry);

/** Pairs per chain in the bundled snapshot; anything above came from chain. */
const snapshotPairCounts = new Map<number, number>(
  gnsPairRegistry
    .chainIds()
    .map((chainId) => [chainId, gnsPairRegistry.knownCount(chainId)]),
);

export function getGnsSnapshotPairCount(chainId: number): number {
  return snapshotPairCounts.get(chainId) ?? 0;
}

function assertChain(chainId: number) {
  if (!gnsPairRegistry.hasChain(chainId)) {
    throw new Error(`Pair configs not found for chainId: ${chainId}`);
  }
}

export function getGnsPair(chainId: number, pairIndex: number): Pair | null {
  assertChain(chainId);
  return gnsPairRegistry.get(chainId, pairIndex);
}

export function getGnsPairByName(
  chainId: number,
  pairName: string,
): Pair | null {
  assertChain(chainId);
  return gnsPairRegistry.getByName(chainId, pairName);
}

export function getGnsPairIndex(chainId: number, pairName: string): number {
  return getGnsPairByName(chainId, pairName)?.pairIndex ?? -1;
}

export function getGnsPairName(
  chainId: number,
  pairIndex: number,
): string | null {
  const pair = getGnsPair(chainId, pairIndex);
  return pair ? formatGnsPairName(pair) : null;
}

/** Like `getGnsPairName`, but never null: unknown pairs get a placeholder. */
export function resolveGnsPairName(chainId: number, pairIndex: number): string {
  return getGnsPairName(chainId, pairIndex) ?? unknownGnsPairName(pairIndex);
}

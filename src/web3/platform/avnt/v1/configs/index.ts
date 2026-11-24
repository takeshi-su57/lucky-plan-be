import { Pair } from '../types';

import pairsSnapshot from './pairs.generated.json';

/** Avantis runs on Base only, so pairs are not keyed by chain. */
export const AVNT_CHAIN_ID = 8453;

/**
 * Committed snapshot of every Avantis pair, regenerated from PairStorage with
 * `npm run config:generate:avnt`. Pair indexes are append-only, so array
 * position equals `pairIndex`. Pairs listed after the snapshot are added at
 * runtime by AvntConfigSyncService (`registerAvntPairs`).
 */
export const avntPairsSnapshot = pairsSnapshot as Pair[];

const pairsByIndex = new Map<number, Pair>();
const pairsByName = new Map<string, Pair>();

export function formatAvntPairName(pair: Pick<Pair, 'from' | 'to'>): string {
  return `${pair.from}/${pair.to}`.toLowerCase();
}

/**
 * Avantis renames a pair to `DELISTED/USD` (or blanks it) when it is
 * removed. Taking that name would relabel every historical trade on the pair,
 * so a known real name is kept instead.
 */
export function isAvntRetiredName(pair: Pick<Pair, 'from'>): boolean {
  return pair.from.trim() === '' || /^delisted$/i.test(pair.from.trim());
}

/** Applies the retired-name rule to pairs read from chain. */
export function preserveRetiredAvntNames(
  onChain: Pair[],
  previous: (pairIndex: number) => Pair | null | undefined,
): Pair[] {
  return onChain.map((pair) => {
    const known = previous(pair.pairIndex);
    return known && isAvntRetiredName(pair) && !isAvntRetiredName(known)
      ? { ...pair, from: known.from, to: known.to }
      : pair;
  });
}

/** Adds or replaces pairs. Returns how many were new or renamed. */
export function registerAvntPairs(pairs: Pair[]): number {
  let changed = 0;

  for (const pair of pairs) {
    const existing = pairsByIndex.get(pair.pairIndex);

    if (existing && formatAvntPairName(existing) === formatAvntPairName(pair)) {
      continue;
    }

    if (existing) {
      pairsByName.delete(formatAvntPairName(existing));
    }

    pairsByIndex.set(pair.pairIndex, pair);
    pairsByName.set(formatAvntPairName(pair), pair);
    changed++;
  }

  return changed;
}

registerAvntPairs(avntPairsSnapshot);

/** Contiguous pairs known from index 0; a sync resumes from here. */
export function getAvntKnownPairCount(): number {
  let count = 0;

  while (pairsByIndex.has(count)) {
    count++;
  }

  return count;
}

/** All known pairs ordered by index. */
export function getAvntPairs(): Pair[] {
  return Array.from(pairsByIndex.values()).sort(
    (a, b) => a.pairIndex - b.pairIndex,
  );
}

export function getPair(pairIndex: number): Pair | null {
  return pairsByIndex.get(pairIndex) ?? null;
}

export function getPairByName(pairName: string): Pair | null {
  return pairsByName.get(pairName.toLowerCase()) ?? null;
}

export function getPairIndex(pairName: string): number {
  return getPairByName(pairName)?.pairIndex ?? -1;
}

export function getPairName(pairIndex: number): string | null {
  const pair = getPair(pairIndex);
  return pair && pair.from.trim() ? formatAvntPairName(pair) : null;
}

/**
 * Name used for a pair the config does not know yet. Parsers return it
 * instead of dropping the event so the raw log is still stored; stored logs
 * are re-parsed on read, so the real name shows up once the pair is synced.
 */
export function unknownAvntPairName(pairIndex: number): string {
  return `pair#${pairIndex}/unknown`;
}

export function resolvePairName(pairIndex: number): string {
  return getPairName(pairIndex) ?? unknownAvntPairName(pairIndex);
}

export const contractAddresses = {
  TradingCallback: '0x0C16ff40065Cc3Ab4bc55B60E447504AFB9C7970',
  TradingStorage: '0x8a311D7048c35985aa31C131B9A13e03a5f7422d',
  PairStorage: '0x5db3772136e5557EFE028Db05EE95C84D76faEC4',
  PairInfos: '0x81F22d0Cc22977c91bEfE648C9fddf1f2bd977e5',
  PriceAggregator: '0x64e2625621970F8cfA17B294670d61CB883dA511',
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  Trading: '0x44914408af82bC9983bbb330e3578E1105e11d4e',
  Multicall: '0x7A829c5C97A2Bf8BeFB4b01d96A282E4763848d8',
  Referral: '0x1A110bBA13A1f16cCa4b79758BD39290f29De82D',
  VaultManager: '0xe9fB8C70aF1b99F2Baaa07Aa926FCf3d237348DD',
};

import { Address } from 'viem';

import type { Collateral, Pair } from '../v10/types';

import pairsSnapshot from './pairs.generated.json';
import collateralsSnapshot from './collaterals.generated.json';

/**
 * JSON shape of a pair in `pairs.generated.json` and in the Metadata rows
 * written by GnsConfigSyncService (bigints are stored as decimal strings).
 */
export type SerializedGnsPair = {
  pairIndex: number;
  from: string;
  to: string;
  feed: {
    feed1: Address;
    feed2: Address;
    feedCalculation: number;
    maxDeviationP: string;
  };
  spreadP: string;
  groupIndex: string;
  feeIndex: string;
};

export type SerializedGnsCollateral = {
  collateralIndex: number;
  collateral: Address;
  isActive: boolean;
  precision: string;
  precisionDelta: string;
  __placeholder: string;
};

export function serializeGnsPair(pair: Pair): SerializedGnsPair {
  return {
    pairIndex: pair.pairIndex,
    from: pair.from,
    to: pair.to,
    feed: {
      feed1: pair.feed.feed1,
      feed2: pair.feed.feed2,
      feedCalculation: pair.feed.feedCalculation,
      maxDeviationP: pair.feed.maxDeviationP.toString(),
    },
    spreadP: pair.spreadP.toString(),
    groupIndex: pair.groupIndex.toString(),
    feeIndex: pair.feeIndex.toString(),
  };
}

export function deserializeGnsPair(pair: SerializedGnsPair): Pair {
  return {
    ...pair,
    feed: { ...pair.feed, maxDeviationP: BigInt(pair.feed.maxDeviationP) },
    spreadP: BigInt(pair.spreadP),
    groupIndex: BigInt(pair.groupIndex),
    feeIndex: BigInt(pair.feeIndex),
  };
}

export function serializeGnsCollateral(
  collateral: Collateral,
): SerializedGnsCollateral {
  return {
    collateralIndex: collateral.collateralIndex,
    collateral: collateral.collateral,
    isActive: collateral.isActive,
    precision: collateral.precision.toString(),
    precisionDelta: collateral.precisionDelta.toString(),
    __placeholder: collateral.__placeholder.toString(),
  };
}

export function deserializeGnsCollateral(
  collateral: SerializedGnsCollateral,
): Collateral {
  return {
    ...collateral,
    precision: BigInt(collateral.precision),
    precisionDelta: BigInt(collateral.precisionDelta),
    __placeholder: BigInt(collateral.__placeholder),
  };
}

/**
 * Committed snapshot of every GNS pair per chain, regenerated from chain by
 * `npm run config:generate:gns`. Pair indexes are append-only, so array
 * position equals `pairIndex`.
 */
export const gnsPairsSnapshot = pairsSnapshot as Record<
  string,
  SerializedGnsPair[]
>;

/** Committed snapshot of V10 collaterals per chain (index 0 = collateral 1). */
export const gnsCollateralsSnapshot = collateralsSnapshot as Record<
  string,
  SerializedGnsCollateral[]
>;

export { gnsDiamondDeployments } from './deployments';

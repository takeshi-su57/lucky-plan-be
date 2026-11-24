import { Collateral } from '../types';
import {
  deserializeGnsCollateral,
  gnsCollateralsSnapshot,
} from '../../configs';

// Pairs live in one registry shared by every GNS version; it is seeded from
// `gns/configs/pairs.generated.json` and topped up at runtime by
// GnsConfigSyncService.
export {
  getGnsPair as getPair,
  getGnsPairByName as getPairByName,
  getGnsPairIndex as getPairIndex,
  getGnsPairName as getPairName,
  resolveGnsPairName as resolvePairName,
} from '../../pair-registry';

export const collateralConfigsMap: Record<number, Collateral[]> = {};

for (const [chainId, collaterals] of Object.entries(gnsCollateralsSnapshot)) {
  collateralConfigsMap[+chainId] = collaterals.map(deserializeGnsCollateral);
}

export function getCollateral(
  chainId: number,
  collateralIndex: number,
): Collateral | null {
  if (!collateralConfigsMap[chainId]) {
    throw new Error(`Collateral configs not found for chainId: ${chainId}`);
  }

  return collateralConfigsMap[chainId][collateralIndex - 1] || null;
}

/**
 * Replaces a chain's collaterals with a list read from chain at runtime
 * (GnsConfigSyncService). Collateral indexes are append-only like pairs.
 */
export function setCollaterals(chainId: number, collaterals: Collateral[]) {
  collateralConfigsMap[chainId] = [...collaterals].sort(
    (a, b) => a.collateralIndex - b.collateralIndex,
  );
}

export function getCollaterals(chainId: number): Collateral[] {
  return collateralConfigsMap[chainId] || [];
}

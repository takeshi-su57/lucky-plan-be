import { Collateral } from '../types';
import { collateralConfigs } from './collateralsConfig';

// Pairs live in one registry shared by every GNS version; it is seeded from
// the bundled snapshot and kept current from chain by GnsConfigSyncService.
export {
  getGnsPair as getPair,
  getGnsPairByName as getPairByName,
  getGnsPairIndex as getPairIndex,
  getGnsPairName as getPairName,
  resolveGnsPairName as resolvePairName,
} from '../../pair-registry';

export const collateralConfigsMap: Record<number, Collateral[]> = {};

for (const [chainId, collaterals] of Object.entries(collateralConfigs)) {
  collateralConfigsMap[+chainId] = collaterals.map((collateral) => ({
    ...collateral,
    precision: BigInt(collateral.precision),
    precisionDelta: BigInt(collateral.precisionDelta),
    __placeholder: BigInt(collateral.__placeholder),
  }));
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

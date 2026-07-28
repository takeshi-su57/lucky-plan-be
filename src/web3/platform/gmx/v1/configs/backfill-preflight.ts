import { Platform, Version } from 'generated/prisma/client';

import { gmxV1VaultDeployments } from './contracts';
import { gmxV1IndexTokenConfigs } from './tokens';

type GmxV1BackfillContract = {
  id: number;
  platform: Platform;
  version: Version;
  chainId: number;
  address: string;
  fromBlock: number;
  toBlock: number | null;
};

/** Refuses a V1 scan that does not use the frozen deployment and token snapshot. */
export function assertGmxV1BackfillReady(contract: GmxV1BackfillContract) {
  if (contract.platform !== Platform.GMX || contract.version !== Version.V1) {
    return;
  }

  const deployment = gmxV1VaultDeployments.find(
    (item) => item.chainId === contract.chainId,
  );

  if (!deployment) {
    throw new Error(`Unsupported GMX V1 chain ${contract.chainId}`);
  }

  if (
    contract.address.toLowerCase() !== deployment.address ||
    contract.fromBlock !== deployment.fromBlock ||
    contract.toBlock !== deployment.toBlock
  ) {
    throw new Error(
      `GMX V1 contract ${contract.id} does not match the frozen ${deployment.network} Vault backfill range`,
    );
  }

  const indexTokenCount = Object.values(
    gmxV1IndexTokenConfigs[contract.chainId] || {},
  ).filter((token) => !token.isStable).length;

  if (indexTokenCount === 0) {
    throw new Error(
      `GMX V1 token snapshot is missing for chain ${contract.chainId}. Run npm run config:generate:gmx-v1 before backfilling.`,
    );
  }
}

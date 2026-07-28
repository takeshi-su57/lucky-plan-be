import { describe, expect, it } from '@jest/globals';
import { Platform, Version } from 'generated/prisma/client';

import { assertGmxV1BackfillReady } from './backfill-preflight';
import { gmxV1VaultDeployments } from './contracts';

describe('GMX V1 backfill preflight', () => {
  const arbitrumDeployment = gmxV1VaultDeployments[0];

  it('accepts the frozen deployment and generated snapshot', () => {
    expect(() =>
      assertGmxV1BackfillReady({
        id: 1,
        platform: Platform.GMX,
        version: Version.V1,
        chainId: arbitrumDeployment.chainId,
        address: arbitrumDeployment.address,
        fromBlock: arbitrumDeployment.fromBlock,
        toBlock: arbitrumDeployment.toBlock,
      }),
    ).not.toThrow();
  });

  it('rejects an altered historical range before indexing begins', () => {
    expect(() =>
      assertGmxV1BackfillReady({
        id: 1,
        platform: Platform.GMX,
        version: Version.V1,
        chainId: arbitrumDeployment.chainId,
        address: arbitrumDeployment.address,
        fromBlock: arbitrumDeployment.fromBlock,
        toBlock: arbitrumDeployment.toBlock - 1,
      }),
    ).toThrow('does not match the frozen Arbitrum Vault backfill range');
  });
});

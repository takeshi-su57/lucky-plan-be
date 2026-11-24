import { Address } from 'viem';

import { ChainPriority } from 'src/types';
import { EvmChainsService } from 'src/web3/web3/evm-chains.service';

import { gnsMultiCollatDiamondAbi } from './v10/abi/GNSMultiCollatDiamond';
import { Collateral, Pair } from './v10/types';

const PAIRS_PER_MULTICALL = 100;

/**
 * Read helpers for GNS diamond configuration. Shared by the snapshot
 * generator (GnsConfigService) and the runtime gap-filler (GnsConfigSyncService)
 * so both decode pairs the same way.
 */
export async function readGnsPairsCount(
  chainsService: EvmChainsService,
  chainId: number,
  address: Address,
): Promise<number> {
  return Number(
    await chainsService.readWithSemaphore(
      chainId,
      ChainPriority.LOW,
      (client) =>
        client.readContract({
          address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'pairsCount',
        }),
    ),
  );
}

/** Reads pairs `[fromIndex, toIndex)`; throws if any call fails. */
export async function readGnsPairs(
  chainsService: EvmChainsService,
  chainId: number,
  address: Address,
  fromIndex: number,
  toIndex: number,
): Promise<Pair[]> {
  const pairs: Pair[] = [];

  for (let start = fromIndex; start < toIndex; start += PAIRS_PER_MULTICALL) {
    const indexes = Array.from(
      { length: Math.min(PAIRS_PER_MULTICALL, toIndex - start) },
      (_, offset) => start + offset,
    );

    const results = await chainsService.readWithSemaphore(
      chainId,
      ChainPriority.LOW,
      (client) =>
        client.multicall({
          allowFailure: false,
          contracts: indexes.map((index) => ({
            address,
            abi: gnsMultiCollatDiamondAbi,
            functionName: 'pairs' as const,
            args: [BigInt(index)] as const,
          })),
        }),
    );

    results.forEach((pair, offset) =>
      pairs.push({ ...pair, pairIndex: indexes[offset] }),
    );
  }

  return pairs;
}

/** Collateral indexes on GNS start at 1. */
export async function readGnsCollaterals(
  chainsService: EvmChainsService,
  chainId: number,
  address: Address,
): Promise<Collateral[]> {
  const collaterals = await chainsService.readWithSemaphore(
    chainId,
    ChainPriority.LOW,
    (client) =>
      client.readContract({
        address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'getCollaterals',
      }),
  );

  return collaterals.map((collateral, index) => ({
    ...collateral,
    collateralIndex: index + 1,
  }));
}

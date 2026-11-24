import { Address } from 'viem';

import { ChainPriority } from 'src/types';
import { EvmChainsService } from 'src/web3/web3/evm-chains.service';

import { pairStorageAbi } from './v1/abi/PairStorage';
import { AVNT_CHAIN_ID, contractAddresses } from './v1/configs';
import { Pair } from './v1/types';

const PAIRS_PER_MULTICALL = 100;
const pairStorage = contractAddresses.PairStorage as Address;

/**
 * Read helpers for Avantis PairStorage on Base. Shared by the snapshot
 * generator (AvntConfigService) and the runtime sync (AvntConfigSyncService).
 */
export async function readAvntPairsCount(
  chainsService: EvmChainsService,
): Promise<number> {
  return Number(
    await chainsService.readWithSemaphore(
      AVNT_CHAIN_ID,
      ChainPriority.LOW,
      (client) =>
        client.readContract({
          address: pairStorage,
          abi: pairStorageAbi,
          functionName: 'pairsCount',
        }),
    ),
  );
}

/** Reads pairs `[fromIndex, toIndex)`; throws if any call fails. */
export async function readAvntPairs(
  chainsService: EvmChainsService,
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
      AVNT_CHAIN_ID,
      ChainPriority.LOW,
      (client) =>
        client.multicall({
          allowFailure: false,
          contracts: indexes.map((index) => ({
            address: pairStorage,
            abi: pairStorageAbi,
            functionName: 'pairData' as const,
            args: [BigInt(index)] as const,
          })),
        }),
    );

    results.forEach(([from, to, numTiers], offset) =>
      pairs.push({
        pairIndex: indexes[offset],
        from,
        to,
        numTiers: numTiers.toString(),
      }),
    );
  }

  return pairs;
}

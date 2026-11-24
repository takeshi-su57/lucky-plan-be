import { describe, expect, it, jest } from '@jest/globals';
import { Platform, Version } from 'generated/prisma/client';

jest.mock('src/web3/web3/evm-chains.service', () => ({
  EvmChainsService: class {},
}));

jest.mock('src/global/prisma.service', () => ({
  PrismaService: class {},
}));

jest.mock(
  'src/microservices/apiService/modules/contracts/contracts.service',
  () => ({ ContractsService: class {} }),
);

import {
  GNS_COLLATERALS_METADATA_PREFIX,
  GNS_PAIRS_METADATA_PREFIX,
  GnsConfigSyncService,
} from './gns-config-sync.service';
import { serializeGnsPair } from './configs';
import { getGnsPairName, gnsPairRegistry } from './pair-registry';
import { getCollaterals } from './v10/configs';
import { Pair } from './v10/types';

// Chain ids that are not in the bundled snapshot keep these tests independent.
const SYNC_CHAIN = 777_001;
const AUTO_CHAIN = 777_002;

const ZERO = '0x0000000000000000000000000000000000000000';
const USDC = '0x00000000000000000000000000000000000000c1';

function onChainPair(from: string): Omit<Pair, 'pairIndex'> {
  return {
    from,
    to: 'USD',
    feed: {
      feed1: ZERO,
      feed2: ZERO,
      feedCalculation: 0,
      maxDeviationP: 0n,
    },
    spreadP: 0n,
    groupIndex: 0n,
    feeIndex: 0n,
  };
}

function setup(chainId: number, persistedFirstPair?: string) {
  const multicallIndexes: number[][] = [];
  const store = new Map<string, string>();

  if (persistedFirstPair) {
    store.set(
      `${GNS_PAIRS_METADATA_PREFIX}${chainId}`,
      JSON.stringify([
        serializeGnsPair({ ...onChainPair(persistedFirstPair), pairIndex: 0 }),
      ]),
    );
  }

  const client = {
    readContract: jest.fn(async ({ functionName }: { functionName: string }) =>
      functionName === 'pairsCount'
        ? 5n
        : [
            {
              collateral: USDC,
              isActive: true,
              __placeholder: 0n,
              precision: 1_000_000n,
              precisionDelta: 1n,
            },
          ],
    ),
    multicall: jest.fn(
      async ({ contracts }: { contracts: { args: readonly [bigint] }[] }) => {
        const indexes = contracts.map((call) => Number(call.args[0]));
        multicallIndexes.push(indexes);
        return indexes.map((index) => onChainPair(`P${index}`));
      },
    ),
  };

  const service = new GnsConfigSyncService(
    {
      metadata: {
        findMany: jest.fn(async () =>
          Array.from(store.entries()).map(([key, value]) => ({ key, value })),
        ),
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(
          async (args: { create: { key: string; value: string } }) => {
            store.set(args.create.key, args.create.value);
          },
        ),
      },
    } as never,
    {
      findAll: jest.fn(async () => [
        {
          chainId,
          address: '0x00000000000000000000000000000000000000aa',
          platform: Platform.GNS,
          version: Version.V10,
        },
      ]),
    } as never,
    {
      readWithSemaphore: jest.fn(
        async (
          _chainId: number,
          _priority: unknown,
          fn: (c: unknown) => unknown,
        ) => fn(client),
      ),
    } as never,
    { nativeLog: jest.fn() } as never,
  );

  return { service, multicallIndexes, store };
}

describe('GnsConfigSyncService', () => {
  it('check reports differences without applying them; sync applies them', async () => {
    const { service, store } = setup(SYNC_CHAIN, 'OLD0');

    const [checked] = await service.check();

    expect(checked.platform).toBe(Platform.GNS);
    expect(checked.sourceCount).toBe(5);
    expect(checked.missing).toEqual([
      '#1 p1/usd',
      '#2 p2/usd',
      '#3 p3/usd',
      '#4 p4/usd',
      `collateral #1 ${USDC}`,
    ]);
    expect(checked.changed).toEqual(['#0 old0/usd -> p0/usd']);
    expect(checked.applied).toEqual([]);
    expect(getGnsPairName(SYNC_CHAIN, 0)).toBe('old0/usd');
    expect(gnsPairRegistry.knownCount(SYNC_CHAIN)).toBe(1);

    const [synced] = await service.sync();

    expect(synced.error).toBeNull();
    expect(synced.applied).toHaveLength(6);
    expect(getGnsPairName(SYNC_CHAIN, 0)).toBe('p0/usd');
    expect(gnsPairRegistry.knownCount(SYNC_CHAIN)).toBe(5);
    expect(getCollaterals(SYNC_CHAIN).map((c) => c.collateral)).toEqual([USDC]);

    const persistedPairs = JSON.parse(
      store.get(`${GNS_PAIRS_METADATA_PREFIX}${SYNC_CHAIN}`)!,
    ) as { pairIndex: number; from: string }[];
    expect(persistedPairs.map((pair) => pair.from)).toEqual([
      'P0',
      'P1',
      'P2',
      'P3',
      'P4',
    ]);
    expect(store.has(`${GNS_COLLATERALS_METADATA_PREFIX}${SYNC_CHAIN}`)).toBe(
      true,
    );
    expect(store.has(`config.status.GNS.${SYNC_CHAIN}`)).toBe(true);

    const [again] = await service.check();
    expect(again.missing).toEqual([]);
    expect(again.changed).toEqual([]);
  });

  it('background sync fetches only the pair indexes still missing', async () => {
    const { service, multicallIndexes } = setup(AUTO_CHAIN, 'P0');

    await service.onModuleInit();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    expect(multicallIndexes).toEqual([[1, 2, 3, 4]]);
    expect(gnsPairRegistry.knownCount(AUTO_CHAIN)).toBe(5);
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'generated/prisma/client';

jest.mock('src/web3/web3/evm-chains.service', () => ({
  EvmChainsService: class {},
}));

jest.mock('src/global/prisma.service', () => ({
  PrismaService: class {},
}));

import {
  AVNT_PAIRS_METADATA_KEY,
  AvntConfigSyncService,
} from './avnt-config-sync.service';
import {
  avntPairsSnapshot,
  getAvntKnownPairCount,
  getPairByName,
  getPairName,
  preserveRetiredAvntNames,
  resolvePairName,
  unknownAvntPairName,
} from './v1/configs';
import { eventToPerpTradeHistory as marketExecutedToHistory } from './v1/eventParsers/market-executed.parser';
import { Pair } from './v1/types';

const SNAPSHOT = avntPairsSnapshot.length;
const NEW_INDEX = SNAPSHOT; // first index the snapshot does not have

function marketOpen(pairIndex: number) {
  return {
    eventName: 'MarketExecuted',
    args: {
      orderId: 1n,
      t: {
        trader: '0x00000000000000000000000000000000000000AA',
        pairIndex: BigInt(pairIndex),
        index: 0n,
        initialPosToken: 100_000_000n,
        positionSizeUSDC: 100_000_000n,
        openPrice: 10_000_000_000n,
        buy: true,
        leverage: 50_000_000_000n,
        tp: 0n,
        sl: 0n,
        timestamp: 0n,
      },
      open: true,
      price: 10_000_000_000n,
      positionSizeUSDC: 100_000_000n,
      percentProfit: 0n,
      usdcSentToTrader: 0n,
    },
  } as never;
}

function setup(onChain: Pair[]) {
  const store = new Map<string, string>();

  const client = {
    readContract: jest.fn(async () => BigInt(onChain.length)),
    multicall: jest.fn(
      async ({ contracts }: { contracts: { args: readonly [bigint] }[] }) =>
        contracts.map((call) => {
          const pair = onChain[Number(call.args[0])];
          return [pair.from, pair.to, BigInt(pair.numTiers)];
        }),
    ),
  };

  const service = new AvntConfigSyncService(
    {
      metadata: {
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) =>
          store.has(where.key)
            ? { key: where.key, value: store.get(where.key)! }
            : null,
        ),
        upsert: jest.fn(
          async (args: { create: { key: string; value: string } }) => {
            store.set(args.create.key, args.create.value);
          },
        ),
      },
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

  return { service, store };
}

describe('AVNT pair config', () => {
  it('keeps the old name when a pair is renamed to DELISTED', () => {
    const [kept, renamed] = preserveRetiredAvntNames(
      [
        { pairIndex: 0, from: 'DELISTED', to: 'USD', numTiers: '1' },
        { pairIndex: 1, from: 'NEW', to: 'USD', numTiers: '1' },
      ],
      () => ({ pairIndex: 0, from: 'STX', to: 'USD', numTiers: '1' }),
    );

    expect(kept.from).toBe('STX');
    expect(renamed.from).toBe('NEW');
  });

  it('parsers keep trades on unknown pairs with a placeholder name', () => {
    expect(getPairName(NEW_INDEX)).toBeNull();
    expect(resolvePairName(NEW_INDEX)).toBe(unknownAvntPairName(NEW_INDEX));
    expect(marketExecutedToHistory(marketOpen(NEW_INDEX))?.pair).toBe(
      unknownAvntPairName(NEW_INDEX),
    );
  });

  it('check reports new pairs; sync applies and persists them', async () => {
    const onChain: Pair[] = [
      ...avntPairsSnapshot,
      { pairIndex: NEW_INDEX, from: 'NEWCOIN', to: 'USD', numTiers: '1' },
    ];
    const { service, store } = setup(onChain);

    const [checked] = await service.check();
    expect(checked.platform).toBe(Platform.AVNT);
    expect(checked.sourceCount).toBe(SNAPSHOT + 1);
    expect(checked.missing).toEqual([`#${NEW_INDEX} newcoin/usd`]);
    expect(checked.changed).toEqual([]);
    expect(getAvntKnownPairCount()).toBe(SNAPSHOT);

    const [synced] = await service.sync();
    expect(synced.applied).toEqual([`#${NEW_INDEX} newcoin/usd`]);
    expect(getPairName(NEW_INDEX)).toBe('newcoin/usd');
    expect(getPairByName('newcoin/usd')?.pairIndex).toBe(NEW_INDEX);
    expect(marketExecutedToHistory(marketOpen(NEW_INDEX))?.pair).toBe(
      'newcoin/usd',
    );

    const persisted = JSON.parse(store.get(AVNT_PAIRS_METADATA_KEY)!) as Pair[];
    expect(persisted.map((pair) => pair.pairIndex)).toEqual([NEW_INDEX]);
    expect(store.has('config.status.AVNT.8453')).toBe(true);
  });
});

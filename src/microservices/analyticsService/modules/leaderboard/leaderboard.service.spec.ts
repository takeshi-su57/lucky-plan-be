import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ContractStatus, Platform, Version } from 'generated/prisma/client';

import { LeaderboardService } from './leaderboard.service';
import { RpcWorkerPoolService } from './rpc-worker-pool.service';
import { getWeb3Info } from 'src/web3/utils';
import { contractAddresses as avntContractAddresses } from 'src/web3/platform/avnt/v1/configs';

jest.mock('src/web3/utils', () => ({
  getWeb3Info: jest.fn(),
}));

jest.mock('src/web3/web3/evm-adapter.service', () => ({
  EvmAdapterService: class {},
}));

jest.mock('src/web3/web3/evm-chains.service', () => ({
  EvmChainsService: class {},
}));

jest.mock('src/global/prisma.service', () => ({
  PrismaService: class {},
}));

jest.mock('src/utils', () => ({
  getReadableError: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
  delay: jest.fn(async () => undefined),
}));

describe('LeaderboardService', () => {
  it('builds perp trading event logs through getWeb3Info eventToPerpTradeHistory', async () => {
    const createManyPerpTradingEventLogs = jest.fn(async (_inputs: any[]) => [
      { contractId: 7 },
    ]);
    const eventToPerpTradeHistory = jest.fn().mockReturnValue({
      address: '0xLeader',
      usdPnl: 42.5,
    });
    (getWeb3Info as jest.Mock).mockReturnValue({
      eventToPerpTradeHistory,
    });
    const service = new LeaderboardService(
      {} as never,
      {} as never,
      { createManyPerpTradingEventLogs } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const eventLog = {
      eventName: 'PositionDecrease',
      args: { account: '0xLeader' },
    };
    const getBlock = jest.fn(async (_blockNumber: bigint) => ({
      timestamp: 1_700_000_000n,
    }));

    const result = await (service as any).handlePerpTradeEventLogs({
      contract: {
        id: 7,
        chainId: 42161,
        platform: Platform.GMX,
        version: Version.V2,
      },
      fromBlock: 100n,
      toBlock: 200n,
      getBlock,
      perpTradeEventLogs: [
        {
          eventLog,
          blockNumber: 123,
          logIndex: 4,
          transactionHash: '0xtx',
        },
      ],
    });

    expect(eventToPerpTradeHistory).toHaveBeenCalledWith(
      42161,
      eventLog,
      undefined,
    );
    expect(getBlock).toHaveBeenCalledWith(100n);
    expect(getBlock).toHaveBeenCalledWith(200n);
    expect(createManyPerpTradingEventLogs).toHaveBeenCalledWith([
      {
        contractId: 7,
        platform: Platform.GMX,
        address: '0xleader',
        jsonLog: JSON.stringify(eventLog),
        usdPnl: 42.5,
        block: 123,
        logIndex: 4,
        transactionHash: '0xtx',
        date: new Date(1_700_000_000 * 1000),
      },
    ]);
    expect(result).toEqual([{ contractId: 7 }]);
  });

  it('skips event logs that cannot be converted to perp trade histories', async () => {
    const createManyPerpTradingEventLogs = jest.fn(
      async (_inputs: any[]) => [],
    );
    (getWeb3Info as jest.Mock).mockReturnValue({
      eventToPerpTradeHistory: jest.fn().mockReturnValue(null),
    });
    const service = new LeaderboardService(
      {} as never,
      {} as never,
      { createManyPerpTradingEventLogs } as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await (service as any).handlePerpTradeEventLogs({
      contract: {
        id: 7,
        chainId: 42161,
        platform: Platform.GMX,
        version: Version.V2,
      },
      fromBlock: 100n,
      toBlock: 200n,
      getBlock: jest.fn(async () => ({ timestamp: 1_700_000_000n })),
      perpTradeEventLogs: [
        {
          eventLog: { eventName: 'Unknown' },
          blockNumber: 123,
          logIndex: 4,
          transactionHash: '0xtx',
        },
      ],
    });

    expect(createManyPerpTradingEventLogs).toHaveBeenCalledWith([]);
  });

  it('interpolates event dates from the batch boundary block timestamps', async () => {
    const createManyPerpTradingEventLogs = jest.fn(
      async (_inputs: any[]) => [],
    );
    (getWeb3Info as jest.Mock).mockReturnValue({
      eventToPerpTradeHistory: jest.fn().mockReturnValue({
        address: '0xLeader',
        usdPnl: 0,
      }),
    });
    const service = new LeaderboardService(
      {} as never,
      {} as never,
      { createManyPerpTradingEventLogs } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const getBlock = jest.fn(async (blockNumber: bigint) => ({
      timestamp: blockNumber === 100n ? 1_700_000_000n : 1_700_000_100n,
    }));

    await (service as any).handlePerpTradeEventLogs({
      contract: {
        id: 7,
        chainId: 42161,
        platform: Platform.GMX,
        version: Version.V2,
      },
      fromBlock: 100n,
      toBlock: 200n,
      getBlock,
      perpTradeEventLogs: [
        {
          eventLog: { eventName: 'PositionIncrease' },
          blockNumber: 150,
          logIndex: 4,
          transactionHash: '0xtx1',
        },
        {
          eventLog: { eventName: 'PositionDecrease' },
          blockNumber: 150,
          logIndex: 5,
          transactionHash: '0xtx2',
        },
      ],
    });

    expect(getBlock).toHaveBeenCalledTimes(2);
    expect(getBlock).toHaveBeenCalledWith(100n);
    expect(getBlock).toHaveBeenCalledWith(200n);
    expect(createManyPerpTradingEventLogs).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ date: new Date(1_700_000_050 * 1000) }),
      ]),
    );
  });

  const buildAggressiveService = (
    workers: any[],
    toBlock: number,
    rpcEndpoints: any[] = [],
    groupConcurrencyOverride: string | null = null,
    // Rate limiting is off by default in tests so they finish quickly.
    groupRateOverride: string | null = '{"DRPC:Free":0}',
    paidOnly = false,
  ) => {
    const updateLastLeaderboardBlockNumber = jest.fn(
      async (_id: number, _block: number) => ({}),
    );
    const logger = { log: jest.fn() };
    const prisma = {
      perpTradingEventLog: { deleteMany: jest.fn() },
      rpcEndpoint: {
        findMany: jest.fn(async () => rpcEndpoints),
        update: jest.fn(async () => ({})),
      },
      metadata: {
        findUnique: jest.fn(async ({ where }: { where: { key: string } }) => {
          const value =
            where.key === 'RPC_BACKFILL_PAID_ONLY'
              ? String(paidOnly)
              : where.key === 'RPC_GROUP_RATE_PER_SECOND'
                ? groupRateOverride
                : groupConcurrencyOverride;
          return value === null ? null : { value };
        }),
      },
    };
    const pool = new RpcWorkerPoolService(
      prisma as never,
      {
        getAggressivePublicClients: jest.fn(() => workers),
        createAggressiveClient: jest.fn(
          (_chainId: number, url: string) =>
            workers.find((worker) => worker.url === url)?.client,
        ),
      } as never,
      logger as never,
    );
    const service = new LeaderboardService(
      {
        getLatestFinalizedBlock: jest.fn(async () => ({
          number: BigInt(toBlock),
        })),
      } as never,
      {
        findOne: jest.fn(async () => ({
          id: 7,
          chainId: 42161,
          status: ContractStatus.Live,
          platform: Platform.GMX,
          version: Version.V2,
          address: '0x0000000000000000000000000000000000000001',
          fromBlock: 1,
          toBlock,
          lastLeaderboardBlockNumber: 0,
        })),
        updateLastLeaderboardBlockNumber,
      } as never,
      { createManyPerpTradingEventLogs: jest.fn(async () => []) } as never,
      logger as never,
      prisma as never,
      pool,
    );

    return { service, pool, updateLastLeaderboardBlockNumber };
  };

  const fakeWorker = (id: string, getLogs: jest.Mock<any>, extra = {}) => ({
    id,
    provider: 'public',
    url: `https://${id}`,
    client: {
      getLogs,
      getBlock: jest.fn(async () => ({ timestamp: 1_700_000_000n })),
    },
    ...extra,
  });

  beforeEach(() => {
    (getWeb3Info as jest.Mock).mockReturnValue({
      tradeEventNames: [],
      eventSignatures: null,
      logEvents: null,
      eventToPerpTradeHistory: jest.fn(),
    });
  });

  it('aggressive adaption retries failed ranges and advances checkpoint only through contiguous completed ranges', async () => {
    const originalBatchSize = LeaderboardService.BATCH_SIZE;
    LeaderboardService.BATCH_SIZE = 2000n;

    const worker1GetLogs = jest
      .fn<() => Promise<any[]>>()
      .mockRejectedValueOnce(new Error('rpc unavailable'))
      .mockResolvedValue([]);
    const worker2GetLogs = jest
      .fn<() => Promise<any[]>>()
      .mockResolvedValue([]);
    const { service, updateLastLeaderboardBlockNumber } =
      buildAggressiveService(
        [
          fakeWorker('worker-1', worker1GetLogs),
          fakeWorker('worker-2', worker2GetLogs),
        ],
        4000,
      );

    try {
      await service.startAdaption(7, false, {
        basePenaltyMs: 1,
        maxPenaltyMs: 1,
      });
    } finally {
      LeaderboardService.BATCH_SIZE = originalBatchSize;
    }

    expect(
      worker1GetLogs.mock.calls.length + worker2GetLogs.mock.calls.length,
    ).toBe(3);
    expect(updateLastLeaderboardBlockNumber.mock.calls.at(-1)).toEqual([
      7, 4000,
    ]);
    const checkpoints = updateLastLeaderboardBlockNumber.mock.calls.map(
      (call) => call[1],
    );
    expect(checkpoints).toEqual([...checkpoints].sort((a, b) => a - b));
  });

  it('trims ranges to a worker max block range and learns limits from errors', async () => {
    const limitedGetLogs = jest
      .fn<(args: { fromBlock: bigint; toBlock: bigint }) => Promise<any[]>>()
      .mockImplementation(async ({ fromBlock, toBlock }) => {
        if (toBlock - fromBlock + 1n > 100n) {
          throw Object.assign(new Error('HTTP request failed.'), {
            status: 400,
            details:
              '{"message":"ranges over 100 blocks are not supported on free plan","code":35}',
          });
        }
        return [];
      });
    const { service, pool, updateLastLeaderboardBlockNumber } =
      buildAggressiveService([fakeWorker('drpc', limitedGetLogs)], 1000);

    await service.startAdaption(7, false, {
      basePenaltyMs: 1,
      maxPenaltyMs: 1,
    });

    const [worker] = pool.getWorkers(42161);
    expect(worker.maxBlockRange).toBe(100);
    expect(worker.penaltyLevel).toBe(0);
    expect(updateLastLeaderboardBlockNumber.mock.calls.at(-1)).toEqual([
      7, 1000,
    ]);
    // One rejected 1000-block call, then ten 100-block calls.
    expect(limitedGetLogs).toHaveBeenCalledTimes(11);
  });

  it('auto-disables endpoints that keep returning permanent errors', async () => {
    const deadGetLogs = jest.fn<() => Promise<any[]>>().mockRejectedValue(
      Object.assign(new Error('HTTP request failed.'), {
        status: 410,
        details: '"This endpoint has been discontinued."',
      }),
    );
    const okGetLogs = jest
      .fn<() => Promise<any[]>>()
      .mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 5)),
      );
    const { service, pool } = buildAggressiveService(
      [fakeWorker('dead', deadGetLogs), fakeWorker('ok', okGetLogs)],
      200_000,
    );

    await service.startAdaption(7, false, {
      basePenaltyMs: 1,
      maxPenaltyMs: 1,
    });

    const dead = pool.getWorkers(42161).find((w) => w.key === 'dead')!;
    expect(dead.state).toBe('Disabled');
    expect(deadGetLogs).toHaveBeenCalledTimes(3);
  });

  it('caps concurrent dRPC free requests across workers', async () => {
    let inFlight = 0;
    let peak = 0;
    const slowGetLogs = () =>
      jest.fn<() => Promise<any[]>>().mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return [];
      });
    const workers = Array.from({ length: 20 }, (_, index) => ({
      ...fakeWorker(`drpc-${index}`, slowGetLogs()),
      provider: 'drpc',
    }));
    const { service, pool } = buildAggressiveService(workers, 100_000);

    await service.startAdaption(7, false, {
      basePenaltyMs: 1,
      maxPenaltyMs: 1,
    });

    expect(peak).toBe(8);
    expect(pool.rateGroups()).toMatchObject([
      { key: 'DRPC:Free', limit: 8, inFlight: 0, ratePerSecond: null },
    ]);

    // A limit saved from the dashboard overrides the default.
    peak = 0;
    const overridden = buildAggressiveService(
      workers,
      100_000,
      [],
      '{"DRPC:Free":3}',
    );
    await overridden.service.startAdaption(7, false, {
      basePenaltyMs: 1,
      maxPenaltyMs: 1,
    });

    expect(peak).toBe(3);
    expect(overridden.pool.rateGroups()).toMatchObject([
      { key: 'DRPC:Free', limit: 3, inFlight: 0 },
    ]);
  });

  it('spaces dRPC free requests by the group rate limit', async () => {
    const starts: number[] = [];
    const getLogs = () =>
      jest.fn<() => Promise<any[]>>().mockImplementation(async () => {
        starts.push(Date.now());
        return [];
      });
    const workers = Array.from({ length: 10 }, (_, index) => ({
      ...fakeWorker(`drpc-${index}`, getLogs(), { maxBlockRange: 100 }),
      provider: 'drpc',
    }));
    // 600 blocks / 100-block ranges = 6 requests at 10 requests/second.
    const { service } = buildAggressiveService(
      workers,
      600,
      [],
      null,
      '{"DRPC:Free":10}',
    );

    await service.startAdaption(7, false, {
      basePenaltyMs: 1,
      maxPenaltyMs: 1,
    });

    expect(starts).toHaveLength(6);
    const gaps = starts.slice(1).map((at, index) => at - starts[index]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(90);
  });

  it('cools the whole group down on a rate limit instead of penalizing one token', async () => {
    let calls = 0;
    const getLogs = () =>
      jest.fn<() => Promise<any[]>>().mockImplementation(async () => {
        calls++;
        if (calls === 1) {
          throw new Error(
            'You reached free plan rate limit, please upgrade to paid plan',
          );
        }
        return [];
      });
    const workers = Array.from({ length: 3 }, (_, index) => ({
      ...fakeWorker(`drpc-${index}`, getLogs()),
      provider: 'drpc',
    }));
    const { service, pool } = buildAggressiveService(workers, 300);
    const started = Date.now();

    await service.startAdaption(7, false, {
      basePenaltyMs: 60_000,
      maxPenaltyMs: 60_000,
    });

    // A per-worker penalty would have been 60s; the group cooldown is ~1s.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(pool.getWorkers(42161).every((w) => w.penaltyLevel === 0)).toBe(
      true,
    );
    expect(pool.rateGroups()[0].rateLimitedCount).toBe(1);
  });

  const endpointRow = (id: number, worker: any, extra: any = {}) => ({
    id,
    chainId: 42161,
    provider: 'DRPC',
    tier: 'Free',
    label: worker.id,
    url: worker.url,
    maxBlockRange: null,
    concurrency: 1,
    state: 'Active',
    stateReason: null,
    stateChangedAt: null,
    ...extra,
  });

  it('runs a paid endpoint with parallel slots and ranges above the default batch', async () => {
    let inFlight = 0;
    let peak = 0;
    const spans: bigint[] = [];
    const paid = fakeWorker(
      'paid',
      jest
        .fn<(args: { fromBlock: bigint; toBlock: bigint }) => Promise<any[]>>()
        .mockImplementation(async ({ fromBlock, toBlock }) => {
          spans.push(toBlock - fromBlock + 1n);
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 5));
          inFlight--;
          return [];
        }),
    );
    const { service, pool } = buildAggressiveService([paid], 100_000, [
      endpointRow(1, paid, {
        tier: 'Paid',
        maxBlockRange: 10_000,
        concurrency: 4,
      }),
    ]);

    await service.startAdaption(7, false, {
      basePenaltyMs: 1,
      maxPenaltyMs: 1,
    });

    expect(pool.getWorkers(42161).map((w) => w.key)).toEqual([
      'db:1',
      'db:1#1',
      'db:1#2',
      'db:1#3',
    ]);
    expect(peak).toBe(4);
    expect(spans.every((span) => span === 10_000n)).toBe(true);
    expect(spans).toHaveLength(10);
  });

  it('uses only Paid endpoints while paid-only mode is on', async () => {
    const freeGetLogs = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);
    const paidGetLogs = jest.fn<() => Promise<any[]>>().mockResolvedValue([]);
    const free = fakeWorker('free', freeGetLogs);
    const paid = fakeWorker('paid', paidGetLogs);
    const { service } = buildAggressiveService(
      [free, paid],
      20_000,
      [endpointRow(1, free), endpointRow(2, paid, { tier: 'Paid' })],
      null,
      '{"DRPC:Free":0}',
      true,
    );

    await service.startAdaption(7, false, {
      basePenaltyMs: 1,
      maxPenaltyMs: 1,
    });

    expect(freeGetLogs).not.toHaveBeenCalled();
    expect(paidGetLogs).toHaveBeenCalledTimes(5);
  });

  it('fetches Avantis event logs from the trading callback and trading contracts', async () => {
    const service = new LeaderboardService(
      {} as never,
      {} as never,
      { createManyPerpTradingEventLogs: jest.fn(async () => []) } as never,
      { log: jest.fn() } as never,
      {} as never,
      {} as never,
    );
    const getLogs = jest.fn(async () => []);

    const eventLogs = await (service as any).fetchEventLogs({
      contract: {
        id: 7,
        chainId: 8453,
        platform: Platform.AVNT,
        version: Version.V1,
        address: '0x0000000000000000000000000000000000000001',
      },
      getLogs,
    });

    expect(eventLogs).toEqual([]);
    expect(getLogs.mock.calls).toEqual([
      [avntContractAddresses.TradingCallback],
      [avntContractAddresses.Trading],
    ]);
  });
});

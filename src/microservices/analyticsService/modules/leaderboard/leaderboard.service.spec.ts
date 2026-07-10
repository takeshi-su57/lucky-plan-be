import { describe, expect, it, jest } from '@jest/globals';
import { ContractStatus, Platform, Version } from 'generated/prisma/client';

import { LeaderboardService } from './leaderboard.service';
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
      {} as never,
      { createManyPerpTradingEventLogs } as never,
      {} as never,
      {} as never,
    );
    const eventLog = {
      eventName: 'PositionDecrease',
      args: { account: '0xLeader' },
    };

    const result = await (service as any).handlePerpTradeEventLogs({
      contract: {
        id: 7,
        chainId: 42161,
        platform: Platform.GMX,
        version: Version.V2,
      },
      block: { timestamp: 1_700_000_000n },
      perpTradeEventLogs: [
        {
          eventLog,
          blockNumber: 123,
          logIndex: 4,
          transactionHash: '0xtx',
        },
      ],
    });

    expect(eventToPerpTradeHistory).toHaveBeenCalledWith(42161, eventLog);
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
      {} as never,
      { createManyPerpTradingEventLogs } as never,
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
      block: { timestamp: 1_700_000_000n },
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

  it('aggressive adaption retries failed tasks and advances checkpoint only through contiguous completed ranges', async () => {
    const originalBatchSize = LeaderboardService.BATCH_SIZE;
    LeaderboardService.BATCH_SIZE = 2000n;

    const worker1GetLogs = jest
      .fn<() => Promise<any[]>>()
      .mockRejectedValueOnce(new Error('rpc unavailable'))
      .mockResolvedValueOnce([]);
    const worker2GetLogs = jest
      .fn<() => Promise<any[]>>()
      .mockResolvedValue([]);
    const worker1 = {
      id: 'worker-1',
      url: 'https://rpc-1',
      client: {
        getLogs: worker1GetLogs,
        getBlock: jest.fn(async () => ({ timestamp: 1_700_000_000n })),
      },
    };
    const worker2 = {
      id: 'worker-2',
      url: 'https://rpc-2',
      client: {
        getLogs: worker2GetLogs,
        getBlock: jest.fn(async () => ({ timestamp: 1_700_000_000n })),
      },
    };
    const updateLastLeaderboardBlockNumber = jest.fn(async () => ({}));
    const service = new LeaderboardService(
      {
        getLatestFinalizedBlock: jest.fn(async () => ({ number: 4001n })),
      } as never,
      {
        getAggressivePublicClients: jest.fn(() => [worker1, worker2]),
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
          toBlock: 4001,
          lastLeaderboardBlockNumber: 0,
        })),
        updateLastLeaderboardBlockNumber,
      } as never,
      { createManyPerpTradingEventLogs: jest.fn(async () => []) } as never,
      { log: jest.fn() } as never,
      { perpTradingEventLog: { deleteMany: jest.fn() } } as never,
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
    expect(updateLastLeaderboardBlockNumber.mock.calls).toEqual([
      [7, 2001],
      [7, 4001],
    ]);
  });

  it('fetches Avantis event logs from the trading callback and trading contracts', async () => {
    const service = new LeaderboardService(
      {} as never,
      {} as never,
      {} as never,
      { createManyPerpTradingEventLogs: jest.fn(async () => []) } as never,
      { log: jest.fn() } as never,
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

import { describe, expect, it, jest } from '@jest/globals';
import { Platform, Version } from 'generated/prisma/client';

import { LeaderboardService } from './leaderboard.service';
import { getWeb3Info } from 'src/web3/utils';

jest.mock('src/web3/utils', () => ({
  getWeb3Info: jest.fn(),
}));

jest.mock('src/web3/web3/evm-adapter.service', () => ({
  EvmAdapterService: class {},
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
});

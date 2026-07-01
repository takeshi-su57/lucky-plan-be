import { describe, expect, it, jest } from '@jest/globals';
import {
  BotMode,
  PerpTradingEventLog,
  Platform,
  Version,
} from 'generated/prisma/client';

import { EventLogsService } from 'src/microservices/apiService/modules/trade-histories/event-logs.service';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { SimulationCacheService } from './simulation-cache.service';

const eventLogsService = {
  convertToPerpTradePositionsWithSummary: jest.fn(),
} as unknown as EventLogsService;

const prisma = {
  simulationPlanCache: {
    upsert: jest.fn(),
  },
  simulationBotCache: {
    upsert: jest.fn(),
    update: jest.fn(),
    findMany: jest.fn(),
  },
  simulationBotCachedEventLog: {
    findFirst: jest.fn(),
    createMany: jest.fn(),
    findMany: jest.fn(),
  },
  perpTradingEventLog: {
    findMany: jest.fn(),
  },
  simulationBot: {
    findUniqueOrThrow: jest.fn(),
  },
  contract: {
    findMany: jest.fn(),
  },
  simulationPlan: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
  },
} as any;

describe('SimulationCacheService', () => {
  const service = new SimulationCacheService(prisma, eventLogsService);

  it('marks bot cache incomplete when a lifetime-opened position has no close', () => {
    const bot = {
      id: 1,
      mode: BotMode.Default,
      ratio: 1,
      maxLeverage: 50,
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
      stoppedAt: new Date('2026-05-05T00:00:00.000Z'),
      leaderPlatform: Platform.GNS,
      leaderContracts: [
        {
          id: 12,
          platform: Platform.GNS,
          version: Version.V9,
          chainId: 42161,
        },
      ],
    } as any;

    const histories: PerpTradeHistory[] = [
      {
        id: 1,
        positionKey: 'p1',
        address: '0xabc',
        pair: 'ETH/USD',
        operation: PerpTradeHistoryOperation.OPEN,
        usdPnl: 2,
        usdBasePnl: 2,
        usdFee: 0,
        sizeInUsd: 100,
        leverage: 5,
        collateralInUsd: 20,
        collateralDeltaUsd: 20,
        sizeDeltaUsd: 100,
        leverageDelta: 0,
        isLong: true,
        price: 100,
        collateralUsdPrice: 1,
        date: new Date('2026-05-03T00:00:00.000Z'),
        contractId: 12,
        platform: Platform.GNS,
      },
    ];

    expect(service.isBotCacheComplete(bot, histories)).toBe(false);
  });

  it('marks bot cache complete when every lifetime-opened position is closed', () => {
    const bot = {
      id: 2,
      mode: BotMode.Default,
      ratio: 1,
      maxLeverage: 50,
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
      stoppedAt: new Date('2026-05-05T00:00:00.000Z'),
      leaderPlatform: Platform.GNS,
      leaderContracts: [
        {
          id: 12,
          platform: Platform.GNS,
          version: Version.V9,
          chainId: 42161,
        },
      ],
    } as any;

    const histories: PerpTradeHistory[] = [
      {
        id: 1,
        positionKey: 'p1',
        address: '0xabc',
        pair: 'ETH/USD',
        operation: PerpTradeHistoryOperation.OPEN,
        usdPnl: 2,
        usdBasePnl: 2,
        usdFee: 0,
        sizeInUsd: 100,
        leverage: 5,
        collateralInUsd: 20,
        collateralDeltaUsd: 20,
        sizeDeltaUsd: 100,
        leverageDelta: 0,
        isLong: true,
        price: 100,
        collateralUsdPrice: 1,
        date: new Date('2026-05-03T00:00:00.000Z'),
        contractId: 12,
        platform: Platform.GNS,
      },
      {
        id: 2,
        positionKey: 'p1',
        address: '0xabc',
        pair: 'ETH/USD',
        operation: PerpTradeHistoryOperation.CLOSE,
        usdPnl: -1,
        usdBasePnl: -1,
        usdFee: 0,
        sizeInUsd: 100,
        leverage: 5,
        collateralInUsd: 20,
        collateralDeltaUsd: 20,
        sizeDeltaUsd: 100,
        leverageDelta: 0,
        isLong: true,
        price: 100,
        collateralUsdPrice: 1,
        date: new Date('2026-05-10T00:00:00.000Z'),
        contractId: 12,
        platform: Platform.GNS,
      },
    ];

    expect(service.isBotCacheComplete(bot, histories)).toBe(true);
  });

  it('dedupes copied source logs by cache and source event log id', async () => {
    const bot = {
      leaderAddress: '0xabc',
      leaderPlatform: Platform.GNS,
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
    } as any;

    const sourceLogs: PerpTradingEventLog[] = [
      {
        id: 10,
        address: '0xabc',
        contractId: 12,
        platform: Platform.GNS,
        jsonLog: '{}',
        usdPnl: 1,
        block: 100,
        logIndex: 1,
        date: new Date('2026-05-02T00:00:00.000Z'),
      },
    ];

    prisma.simulationBotCachedEventLog.findFirst.mockResolvedValueOnce(null);
    prisma.perpTradingEventLog.findMany.mockResolvedValueOnce(sourceLogs);
    prisma.simulationBotCachedEventLog.createMany.mockResolvedValueOnce({
      count: 1,
    });

    await service.appendNewEventLogsForBot(33, bot);

    expect(prisma.perpTradingEventLog.findMany).toHaveBeenCalledWith({
      where: {
        address: '0xabc',
        platform: Platform.GNS,
        date: { gte: new Date('2026-05-01T00:00:00.000Z') },
      },
      orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
    });
    expect(prisma.simulationBotCachedEventLog.createMany).toHaveBeenCalledWith({
      data: [
        {
          simulationBotCacheId: 33,
          sourceEventLogId: 10,
          contractId: 12,
          address: '0xabc',
          platform: Platform.GNS,
          block: 100,
          logIndex: 1,
          date: new Date('2026-05-02T00:00:00.000Z'),
          jsonLog: '{}',
          usdPnl: 1,
        },
      ],
      skipDuplicates: true,
    });
  });

  it('rolls up plan cache totals from bot caches', async () => {
    (prisma.simulationBotCache.findMany as any).mockResolvedValueOnce([
      {
        completed: true,
        openedPositions: 0,
        totalPositions: 2,
        totalLeaderPnl: 10,
        totalFollowerPnl: 8,
      },
      {
        completed: true,
        openedPositions: 0,
        totalPositions: 3,
        totalLeaderPnl: 5,
        totalFollowerPnl: 4,
      },
      {
        completed: false,
        openedPositions: 1,
        totalPositions: 2,
        totalLeaderPnl: 2,
        totalFollowerPnl: 1,
      },
    ]);
    (prisma.simulationPlanCache.upsert as any).mockResolvedValueOnce({
      simulationPlanId: 10,
      completedBots: 2,
      incompleteBots: 1,
      totalPositions: 7,
    });

    await expect(service.rebuildPlanCache(10)).resolves.toMatchObject({
      completedBots: 2,
      incompleteBots: 1,
      totalPositions: 7,
    });
  });

  it('compares cached plan totals with current plan record totals', async () => {
    (prisma.simulationPlan.findUnique as any).mockResolvedValueOnce({
      id: 5,
      totalPositions: 7,
      totalLeaderPnl: 10,
      totalFollowerPnl: 8,
      cache: {
        totalPositions: 7,
        totalLeaderPnl: 10,
        totalFollowerPnl: 8,
      },
    });

    await expect(service.comparePlanCacheWithStoredSummary(5)).resolves.toEqual(
      {
        planId: 5,
        differences: [],
      },
    );
  });

  it('builds cache summary with persisted positions and follower pnl arrays', () => {
    const bot = {
      id: 3,
      mode: BotMode.Reversed,
      ratio: 0.5,
      maxLeverage: 50,
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
      stoppedAt: new Date('2026-05-05T00:00:00.000Z'),
      leaderPlatform: Platform.GNS,
      leaderContracts: [
        {
          id: 12,
          platform: Platform.GNS,
          version: Version.V9,
          chainId: 42161,
        },
      ],
    } as any;

    const histories: PerpTradeHistory[] = [
      {
        id: 1,
        positionKey: 'p1',
        address: '0xabc',
        pair: 'ETH/USD',
        operation: PerpTradeHistoryOperation.OPEN,
        usdPnl: 4,
        usdBasePnl: 4,
        usdFee: -1,
        sizeInUsd: 100,
        leverage: 5,
        collateralInUsd: 20,
        collateralDeltaUsd: 20,
        sizeDeltaUsd: 100,
        leverageDelta: 0,
        isLong: true,
        price: 100,
        collateralUsdPrice: 1,
        date: new Date('2026-05-03T00:00:00.000Z'),
        contractId: 12,
        platform: Platform.GNS,
      },
      {
        id: 2,
        positionKey: 'p1',
        address: '0xabc',
        pair: 'ETH/USD',
        operation: PerpTradeHistoryOperation.CLOSE,
        usdPnl: -2,
        usdBasePnl: -2,
        usdFee: 0,
        sizeInUsd: 100,
        leverage: 5,
        collateralInUsd: 20,
        collateralDeltaUsd: 20,
        sizeDeltaUsd: 100,
        leverageDelta: 0,
        isLong: true,
        price: 100,
        collateralUsdPrice: 1,
        date: new Date('2026-05-06T00:00:00.000Z'),
        contractId: 12,
        platform: Platform.GNS,
      },
    ];

    jest
      .spyOn(service, 'buildHistoriesFromCachedLogs')
      .mockReturnValueOnce(histories);
    (
      eventLogsService.convertToPerpTradePositionsWithSummary as jest.Mock
    ).mockReturnValueOnce({
      positions: [{ histories }],
      openedPositions: 0,
      totalPnl: 2,
      totalPositions: 1,
      avgDuration: 10,
      maxDuration: 10,
      avgPnl: 2,
      avgPositivePnl: 2,
      avgNegativePnl: 0,
      avgSize: 100,
      avgCollateral: 20,
      avgPnlPercentageBySize: 2,
      avgPnlPercentageByCollateral: 10,
      avgLeverage: 5,
    });

    const summary = service.buildBotSummaryFromCachedLogs(bot, []);

    expect(summary.followerPositionPnls).toEqual([-1.5]);
    expect(summary.positions).toEqual([
      {
        histories: [
          {
            leader: histories[0],
            follower: expect.objectContaining({
              id: -1,
              usdPnl: -2.5,
              usdBasePnl: -2,
              isLong: false,
            }),
          },
          {
            leader: histories[1],
            follower: expect.objectContaining({
              id: -2,
              usdPnl: 1,
              usdBasePnl: 1,
              isLong: false,
            }),
          },
        ],
        leaderPnl: 2,
        followerPnl: -1.5,
      },
    ]);
  });
});

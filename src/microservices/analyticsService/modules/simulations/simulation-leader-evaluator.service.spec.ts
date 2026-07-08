import { describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform } from 'generated/prisma/enums';

import { SimulationLeaderEvaluatorService } from './simulation-leader-evaluator.service';

describe('SimulationLeaderEvaluatorService', () => {
  const createCacheService = () =>
    ({
      countRecentEvents: jest.fn(async () => 3),
      getLastEventAt: jest.fn(() => new Date('2026-04-01T00:00:00.000Z')),
      readLeaderEventLogs: jest.fn(async () => []),
    });

  it('prefilters candidate activity in batches of 100 addresses', async () => {
    const candidateRecords = Array.from({ length: 101 }, (_, index) => ({
      address: `0xleader${index}`,
    }));
    const prisma = {
      pnlSnapshotV2: {
        findMany: jest.fn(async ({ skip = 0, take }: any) =>
          candidateRecords.slice(skip, skip + take),
        ),
      },
    };
    const cacheService = {
      ...createCacheService(),
      countRecentEvents: jest.fn(async () => 3),
    };
    const service = new SimulationLeaderEvaluatorService(
      prisma as never,
      {} as never,
      cacheService as never,
    );

    const result = await service.findCandidateLeaders(
      {
        platform: Platform.GNS,
        direction: BotMode.Default,
        trade: { min: 3, max: 100 },
      } as never,
      {
        startedAt: new Date('2026-04-02T00:00:00.000Z'),
        endedAt: new Date('2026-04-03T00:00:00.000Z'),
      },
    );

    expect(result).toHaveLength(101);
    expect(prisma.pnlSnapshotV2.findMany).toHaveBeenCalledTimes(2);
    expect(cacheService.countRecentEvents).toHaveBeenCalledTimes(101);
  });

  it('filters evaluated leaders outside the simulation score range', async () => {
    const service = new SimulationLeaderEvaluatorService(
      {
        perpTradingEventLog: {
          groupBy: jest.fn(async () => [
            {
              address: '0xequal',
              _max: { date: new Date('2026-04-01T00:00:00.000Z') },
            },
          ]),
        },
      } as never,
      {} as never,
      createCacheService() as never,
    );
    const simulation = {
      id: 1,
      platform: Platform.GNS,
      direction: BotMode.Reversed,
      score: { min: 0.5, max: 0.9 },
    };
    jest
      .spyOn(service as any, 'loadLeaderPositionsByLeaderUntil')
      .mockResolvedValue([]);
    jest
      .spyOn(service as any, 'evaluateLeaderPositionsForSimulation')
      .mockImplementation(((leaderAddress: string) => ({
        leaderAddress,
        score:
          leaderAddress === '0xlow'
            ? 0.49
            : leaderAddress === '0xhigh'
              ? 0.91
              : 0.5,
      })) as any);

    const evaluations = await service.evaluateLeadersForRange(
      simulation as never,
      ['0xlow', '0xequal', '0xhigh'],
      {
        startedAt: new Date('2026-04-02T00:00:00.000Z'),
        endedAt: new Date('2026-04-03T00:00:00.000Z'),
      },
      new Map(),
    );

    expect(evaluations).toEqual([
      {
        leaderAddress: '0xequal',
        score: 0.5,
        lastEventAt: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);
  });

  it('evaluates leaders one at a time so event logs can be cached per address', async () => {
    const service = new SimulationLeaderEvaluatorService(
      {
        perpTradingEventLog: {
          groupBy: jest.fn(async () => []),
        },
      } as never,
      {} as never,
      createCacheService() as never,
    );
    const leaderAddresses = Array.from(
      { length: 21 },
      (_, index) => `0xleader${index}`,
    );
    const loadLeaderPositionsByLeaderUntil = jest
      .spyOn(service as any, 'loadLeaderPositionsByLeaderUntil')
      .mockResolvedValue([]);
    jest
      .spyOn(service as any, 'evaluateLeaderPositionsForSimulation')
      .mockImplementation(((leaderAddress: string) => ({
        leaderAddress,
        score: 0.5,
      })) as any);

    await service.evaluateLeadersForRange(
      {
        id: 1,
        platform: Platform.GNS,
        direction: BotMode.Default,
        score: { min: 0, max: 1 },
      } as never,
      leaderAddresses,
      {
        startedAt: new Date('2026-04-02T00:00:00.000Z'),
        endedAt: new Date('2026-04-03T00:00:00.000Z'),
      },
      new Map(),
    );

    expect(loadLeaderPositionsByLeaderUntil).toHaveBeenCalledTimes(21);
    expect(loadLeaderPositionsByLeaderUntil.mock.calls[0][0]).toBe(
      leaderAddresses[0],
    );
    expect(loadLeaderPositionsByLeaderUntil.mock.calls[20][0]).toBe(
      leaderAddresses[20],
    );
  });

  it('loads one leader event logs from the research cache using a 180 day scoring window', async () => {
    const prisma = {
      perpTradingEventLog: {
        findMany: jest.fn(async () => {
          throw new Error('event log DB should not be queried');
        }),
      },
    };
    const cacheService = {
      readLeaderEventLogs: jest.fn(async () => []),
    };
    const service = new SimulationLeaderEvaluatorService(
      prisma as never,
      {
        convertToPerpTradePositionsWithSummary: jest.fn(() => ({
          positions: [],
        })),
      } as never,
      cacheService as never,
    );
    const before = new Date('2026-04-02T00:00:00.000Z');

    await (service as any).loadLeaderPositionsByLeaderUntil(
      '0xLeader',
      {
        id: 1,
        platform: Platform.GNS,
        collateral: { min: 10, max: 500 },
        leverage: { min: 1, max: 100 },
      },
      new Map(),
      before,
    );

    expect(prisma.perpTradingEventLog.findMany).not.toHaveBeenCalled();
    expect(cacheService.readLeaderEventLogs as jest.Mock).toHaveBeenCalledWith(
      Platform.GNS,
      '0xleader',
      new Date('2025-10-04T00:00:00.000Z'),
      before,
    );
  });

  it('converts cached leader event logs returned from the cache service', async () => {
    const cachedRecord = {
      id: 1,
      address: '0xleader',
      platform: Platform.GNS,
      date: new Date('2026-03-01T00:00:00.000Z'),
      block: 1,
      contractId: 11,
      jsonLog: '{}',
    };
    const prisma = {
      perpTradingEventLog: {
        findMany: jest.fn(async () => [cachedRecord]),
      },
    };
    const eventLogsService = {
      convertToPerpTradePositionsWithSummary: jest.fn(() => ({
        positions: [],
      })),
    };
    const service = new SimulationLeaderEvaluatorService(
      prisma as never,
      eventLogsService as never,
      {
        readLeaderEventLogs: jest.fn(async () => [cachedRecord]),
      } as never,
    );
    jest
      .spyOn(service as any, 'eventLogsToHistories')
      .mockImplementation((records: any) => records);

    await (service as any).loadLeaderPositionsByLeaderUntil(
      '0xLeader',
      {
        id: 1,
        platform: Platform.GNS,
        collateral: { min: 10, max: 500 },
        leverage: { min: 1, max: 100 },
      },
      new Map(),
      new Date('2026-04-02T00:00:00.000Z'),
    );

    expect(
      eventLogsService.convertToPerpTradePositionsWithSummary as jest.Mock,
    ).toHaveBeenCalledWith(
      Platform.GNS,
      [expect.objectContaining({ id: 1 })],
      expect.any(Object),
    );
  });

  it('uses the preliminary score as the candidate quality score after sizing', () => {
    const service = new SimulationLeaderEvaluatorService(
      {} as never,
      {} as never,
      createCacheService() as never,
    );
    const simulation = {
      id: 1,
      platform: Platform.GNS,
      direction: BotMode.Default,
      score: { min: 0, max: 1 },
      trade: { min: 1, max: 10 },
      r2: { min: 0, max: 1 },
      slope: { min: 0, max: 100 },
      standardCollateralUsd: 100,
    };
    const positions = [
      {
        histories: [
          {
            usdPnl: 0,
            usdBasePnl: 0,
            collateralInUsd: 100,
          },
          {
            usdPnl: 50,
            usdBasePnl: 50,
            collateralInUsd: 100,
          },
        ],
      },
      {
        histories: [
          {
            usdPnl: 0,
            usdBasePnl: 0,
            collateralInUsd: 100,
          },
          {
            usdPnl: 100,
            usdBasePnl: 100,
            collateralInUsd: 100,
          },
        ],
      },
    ];
    jest
      .spyOn(service as any, 'simulateCopyApproximation')
      .mockReturnValueOnce({
        netPnlUsd: 300,
        maxDrawdownUsd: 10,
        slope: 50,
        r2: 1,
        profitFactor: 3,
        totalCostUsd: 0,
        grossProfitUsd: 300,
        topTradeProfitUsd: 100,
      })
      .mockReturnValueOnce({
        netPnlUsd: 75,
        maxDrawdownUsd: 4,
        slope: 12,
        r2: 0.6,
        profitFactor: 2,
        totalCostUsd: 0,
        grossProfitUsd: 75,
        topTradeProfitUsd: 40,
      });
    const scoreCandidate = jest
      .spyOn(service as any, 'scoreCandidate')
      .mockReturnValueOnce(0.8)
      .mockReturnValueOnce(0.2);

    const evaluation = (service as any).evaluateLeaderPositionsForSimulation(
      '0xleader',
      positions,
      simulation,
    );

    expect(evaluation.score).toBe(0.8);
    expect(evaluation.copiedNetPnlUsd).toBe(75);
    expect(evaluation.copiedDrawdownUsd).toBe(4);
    expect(scoreCandidate).toHaveBeenCalledTimes(1);
  });

  it('rejects likely bot traders whose average position duration is under 10 minutes', () => {
    const service = new SimulationLeaderEvaluatorService(
      {} as never,
      {} as never,
      createCacheService() as never,
    );
    const simulation = {
      id: 1,
      platform: Platform.GNS,
      direction: BotMode.Default,
      score: { min: 0, max: 1 },
      trade: { min: 1, max: 10 },
      r2: { min: 0, max: 1 },
      slope: { min: 0, max: 100 },
      standardCollateralUsd: 100,
    };
    const positions = [
      {
        histories: [
          {
            usdPnl: 0,
            usdBasePnl: 0,
            collateralInUsd: 100,
            date: new Date('2026-04-01T00:00:00.000Z'),
          },
          {
            usdPnl: 50,
            usdBasePnl: 50,
            collateralInUsd: 100,
            date: new Date('2026-04-01T00:05:00.000Z'),
          },
        ],
      },
    ];

    const evaluation = (service as any).evaluateLeaderPositionsForSimulation(
      '0xbot',
      positions,
      simulation,
    );

    expect(evaluation.rejectedReason).toBe('BOT_TRADER_AVG_DURATION_TOO_SHORT');
  });

  it('applies direction to trading pnl and applies platform fees without reversing them', () => {
    const service = new SimulationLeaderEvaluatorService(
      {} as never,
      {} as never,
      createCacheService() as never,
    );
    const positions = [
      {
        histories: [
          {
            usdPnl: 9.75,
            usdBasePnl: 100,
            usdFee: -0.25,
            collateralInUsd: 100,
          },
        ],
      },
    ];

    const result = (service as any).simulateCopyApproximation(
      positions,
      0.1,
      BotMode.Reversed,
    );

    expect(result.grossPnlUsd).toBe(-1.5);
    expect(result.netPnlUsd).toBe(-1.5);
    expect(result.totalCostUsd).toBe(0.5);
  });
});

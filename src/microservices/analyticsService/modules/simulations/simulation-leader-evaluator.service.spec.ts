import { describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform } from 'generated/prisma/enums';

import { SimulationLeaderEvaluatorService } from './simulation-leader-evaluator.service';

describe('SimulationLeaderEvaluatorService', () => {
  it('filters changed default leaders by positive 3 month pnl snapshot and recent activity', async () => {
    const prisma = {
      pnlSnapshotV2: {
        findMany: jest.fn(async () => [
          { address: '0xpass' },
          { address: '0xlow' },
        ]),
      },
      perpTradingEventLog: {
        groupBy: jest.fn(async () => [
          { address: '0xpass', _count: { address: 3 } },
          { address: '0xlow', _count: { address: 1 } },
        ]),
      },
    };
    const service = new SimulationLeaderEvaluatorService(
      prisma as never,
      {} as never,
    );

    const result = await service.filterCandidateLeaderAddresses(
      {
        platform: Platform.GNS,
        direction: BotMode.Default,
        trade: { min: 3, max: 100 },
      } as never,
      ['0xpass', '0xlow', '0xmissing'],
      {
        startedAt: new Date('2026-04-02T00:00:00.000Z'),
        endedAt: new Date('2026-04-03T00:00:00.000Z'),
      },
    );

    expect(prisma.pnlSnapshotV2.findMany as any).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accUSDPnl: { gte: 50 },
          address: { in: ['0xpass', '0xlow', '0xmissing'] },
        }),
      }),
    );
    expect(result).toEqual(['0xpass']);
  });

  it('filters changed reversed leaders by negative 3 month pnl snapshot', async () => {
    const prisma = {
      pnlSnapshotV2: {
        findMany: jest.fn(async () => [{ address: '0xpass' }]),
      },
      perpTradingEventLog: {
        groupBy: jest.fn(async () => [
          { address: '0xpass', _count: { address: 3 } },
        ]),
      },
    };
    const service = new SimulationLeaderEvaluatorService(
      prisma as never,
      {} as never,
    );

    const result = await service.filterCandidateLeaderAddresses(
      {
        platform: Platform.GNS,
        direction: BotMode.Reversed,
        trade: { min: 3, max: 100 },
      } as never,
      ['0xpass', '0xweak'],
      {
        startedAt: new Date('2026-04-02T00:00:00.000Z'),
        endedAt: new Date('2026-04-03T00:00:00.000Z'),
      },
    );

    expect(prisma.pnlSnapshotV2.findMany as any).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accUSDPnl: { lte: -50 },
          address: { in: ['0xpass', '0xweak'] },
        }),
      }),
    );
    expect(result).toEqual(['0xpass']);
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
    );
    const simulation = {
      id: 1,
      platform: Platform.GNS,
      direction: BotMode.Reversed,
      score: { min: 0.5, max: 0.9 },
    };
    jest
      .spyOn(service as any, 'loadLeaderPositionsUntil')
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

  it('uses the preliminary score as the candidate quality score after sizing', () => {
    const service = new SimulationLeaderEvaluatorService(
      {} as never,
      {} as never,
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

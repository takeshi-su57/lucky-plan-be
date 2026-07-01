import { describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';

import { SimulationsService } from './simulations.service';

describe('SimulationsService API queue requests', () => {
  it('marks a simulation as queued without running analytics execution', async () => {
    const simulation = {
      id: 1,
      title: 'Research simulation',
      description: 'Queued from API',
      platform: Platform.GNS,
      researchId: null,
      direction: BotMode.Reversed,
      startAt: new Date('2026-05-01T00:00:00.000Z'),
      endAt: new Date('2026-06-01T00:00:00.000Z'),
      cursor: null,
      status: SimulationStatus.Created,
      progressPhase: 'created',
      progressMessage: 'Simulation created',
      progressPercent: 0,
      selectedLeaderCount: 10,
      trade: { min: 3, max: 100 },
      r2: { min: 0.5, max: 1 },
      slope: { min: 0, max: 100 },
      standardCollateralUsd: 100,
      maxLeverage: 50,
      totalSimulationPlans: 31,
      completedPlans: 0,
      totalLeaderPnl: 0,
      totalFollowerPnl: 0,
      totalNetPnlUsd: 0,
      totalCostUsd: 0,
      maxDrawdownUsd: 0,
      tradeCount: 0,
      winRate: 0,
      profitFactor: 0,
      error: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    };
    const updated = {
      ...simulation,
      status: SimulationStatus.Paused,
      progressPhase: 'queued',
      progressMessage: 'Simulation queued for analytics automation',
    };
    const prisma = {
      simulation: {
        findUnique: jest.fn(async () => simulation),
        update: jest.fn(async () => updated),
      },
    };
    const service = new SimulationsService(prisma as never, {} as never);

    const result = await service.playAutoSimulation(1);

    expect((prisma.simulation.update as any).mock.calls[0][0]).toEqual({
      where: { id: 1 },
      data: {
        status: SimulationStatus.Paused,
        error: null,
        progressPhase: 'queued',
        progressMessage: 'Simulation queued for analytics automation',
      },
    });
    expect(result.status).toBe(SimulationStatus.Paused);
  });

  it('returns cached simulation plan totals for auto simulation plan rows', async () => {
    const cachedPlan = {
      id: 1759,
      title: 'test 2026-04-05',
      description: 'test',
      startAt: new Date('2026-04-04T21:00:00.000Z'),
      endAt: new Date('2026-04-05T20:00:00.000Z'),
      cursor: new Date('2026-04-05T20:00:00.000Z'),
      simulationId: 17878,
      openedPositions: 0,
      totalPositions: 0,
      totalLeaderPnl: 0,
      totalFollowerPnl: 0,
      cache: {
        openedPositions: 2,
        totalPositions: 1094,
        totalLeaderPnl: 8438.86,
        totalFollowerPnl: 438.109,
      },
      simulationBots: [
        {
          id: 25,
          leaderAddress: '0xabc',
          ratio: 1,
          maxLeverage: 5,
          simulationPlanId: 1759,
          leaderPlatform: Platform.GNS,
          startedAt: new Date('2026-04-04T21:00:00.000Z'),
          stoppedAt: null,
          mode: BotMode.Reversed,
          openedPositions: 0,
          totalPositions: 0,
          totalPnl: 0,
          maxDuration: 0,
          avgDuration: 0,
          avgPnl: 0,
          avgPositivePnl: 0,
          avgNegativePnl: 0,
          avgSize: 0,
          avgCollateral: 0,
          avgPnlPercentageByCollateral: 0,
          avgPnlPercentageBySize: 0,
          avgLeverage: 0,
          cache: {
            openedPositions: 1,
            totalPositions: 44,
            totalLeaderPnl: 123,
            maxDuration: 10,
            avgDuration: 2,
            avgPnl: 3,
            avgPositivePnl: 4,
            avgNegativePnl: -1,
            avgSize: 5,
            avgCollateral: 6,
            avgPnlPercentageBySize: 7,
            avgPnlPercentageByCollateral: 8,
            avgLeverage: 9,
          },
        },
      ],
    };
    const prisma = {
      simulationPlan: {
        findMany: jest.fn(async () => [cachedPlan]),
      },
    };
    const service = new SimulationsService(prisma as never, {} as never);

    const result = await service.getSimulationPlansBySimulation(17878);

    expect((prisma.simulationPlan.findMany as any).mock.calls[0][0]).toEqual({
      where: { simulationId: 17878 },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      include: {
        cache: true,
        simulationBots: {
          include: {
            cache: true,
          },
        },
      },
    });
    expect(result[0].totalPositions).toBe(1094);
    expect(result[0].totalFollowerPnl).toBe(438.109);
    expect(result[0].totalLeaderPnl).toBe(8438.86);
    expect(result[0].openedPositions).toBe(2);
    expect(result[0].simulationBots[0].totalPositions).toBe(44);
    expect(result[0].simulationBots[0].totalPnl).toBe(123);
  });
});

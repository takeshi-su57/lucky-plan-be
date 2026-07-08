import { describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';

import { SimulationsService } from './simulations.service';
import {
  DEFAULT_SCORE_FORMULAR,
  DEFAULT_SIZING_FORMULAR,
  SimulationScoreFormular,
  SimulationSizingFormular,
} from './simulation-formulars';

function createResearchRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    title: 'Runtime research',
    description: 'Research automation state',
    platform: Platform.GNS,
    startAt: new Date('2026-07-01T00:00:00.000Z'),
    endAt: new Date('2026-07-10T00:00:00.000Z'),
    direction: BotMode.Reversed,
    days: 3,
    gapDays: 2,
    trade: [{ min: 3, max: 10 }],
    r2: [{ min: 0.5, max: 1 }],
    slope: [{ min: 0, max: 100 }],
    collateral: [{ min: 10, max: 500 }],
    leverage: [{ min: 10, max: 50 }],
    score: [{ min: 0.5, max: 0.8 }],
    scoreFormular: DEFAULT_SCORE_FORMULAR,
    sizingFormular: DEFAULT_SIZING_FORMULAR,
    cursor: null,
    status: SimulationStatus.Created,
    progressPhase: 'created',
    progressMessage: 'Research created',
    progressPercent: 0,
    totalRanges: 2,
    completedRanges: 0,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    simulations: [{ status: SimulationStatus.Created }],
    ...overrides,
  };
}

describe('SimulationsService API queue requests', () => {
  it('deletes a simulation research with child simulations, plans, and bots', async () => {
    const tx = {
      simulationResearch: {
        findUnique: jest.fn(async () => ({
          id: 7,
          simulations: [
            { id: 11, status: SimulationStatus.Completed },
            { id: 12, status: SimulationStatus.Created },
          ],
        })),
        delete: jest.fn(async () => ({ id: 7 })),
      },
      simulationPlan: {
        findMany: jest.fn(async () => [{ id: 101 }, { id: 102 }]),
        deleteMany: jest.fn(async () => ({ count: 2 })),
      },
      simulationBot: {
        deleteMany: jest.fn(async () => ({ count: 3 })),
      },
      simulation: {
        deleteMany: jest.fn(async () => ({ count: 2 })),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const service = new SimulationsService(prisma as never, {} as never);

    const result = await service.deleteSimulationResearch(7);

    expect(result).toBe(7);
    expect(tx.simulationPlan.findMany as any).toHaveBeenCalledWith({
      where: { simulationId: { in: [11, 12] } },
      select: { id: true },
    });
    expect(tx.simulationBot.deleteMany as any).toHaveBeenCalledWith({
      where: { simulationPlanId: { in: [101, 102] } },
    });
    expect(tx.simulationPlan.deleteMany as any).toHaveBeenCalledWith({
      where: { id: { in: [101, 102] } },
    });
    expect(tx.simulation.deleteMany as any).toHaveBeenCalledWith({
      where: { id: { in: [11, 12] } },
    });
    expect(tx.simulationResearch.delete as any).toHaveBeenCalledWith({
      where: { id: 7 },
    });
  });

  it('rejects deleting research while a child simulation is running', async () => {
    const tx = {
      simulationResearch: {
        findUnique: jest.fn(async () => ({
          id: 7,
          simulations: [{ id: 11, status: SimulationStatus.Running }],
        })),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const service = new SimulationsService(prisma as never, {} as never);

    await expect(service.deleteSimulationResearch(7)).rejects.toThrow(
      'Cannot delete research with a running simulation',
    );
  });

  it('creates research simulations with multi-day plan windows and gap days', async () => {
    const createdResearch = {
      id: 91,
      title: 'Windowed research',
      description: 'Three days with gaps',
      platform: Platform.GNS,
      startAt: new Date('2026-07-01T00:00:00.000Z'),
      endAt: new Date('2026-07-10T00:00:00.000Z'),
      direction: BotMode.Reversed,
      days: 3,
      gapDays: 2,
      trade: [{ min: 3, max: 10 }],
      r2: [{ min: 0.5, max: 1 }],
      slope: [{ min: 0, max: 100 }],
      collateral: [{ min: 10, max: 500 }],
      leverage: [{ min: 10, max: 50 }],
      score: [{ min: 0.5, max: 0.8 }],
      scoreFormular: DEFAULT_SCORE_FORMULAR,
      sizingFormular: DEFAULT_SIZING_FORMULAR,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      simulations: [{ status: SimulationStatus.Created }],
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) =>
        callback({
          simulationResearch: {
            create: jest.fn(async () => createdResearch),
            findUniqueOrThrow: jest.fn(async () => createdResearch),
          },
          simulation: {
            createMany: jest.fn(async () => ({ count: 1 })),
          },
        }),
      ),
    };
    const service = new SimulationsService(prisma as never, {} as never);

    const result = await service.createSimulationResearch({
      title: 'Windowed research',
      description: 'Three days with gaps',
      platform: Platform.GNS,
      startAt: new Date('2026-07-01T00:00:00.000Z'),
      endAt: new Date('2026-07-10T00:00:00.000Z'),
      direction: BotMode.Reversed,
      days: 3,
      gapDays: 2,
      trade: [{ min: 3, max: 10 }],
      r2: [{ min: 0.5, max: 1 }],
      slope: [{ min: 0, max: 100 }],
      collateral: [{ min: 10, max: 500 }],
      leverage: [{ min: 10, max: 50 }],
      score: [{ min: 0.5, max: 0.8 }],
      scoreFormular: SimulationScoreFormular.RiskAdjustedCopyScore,
      sizingFormular: SimulationSizingFormular.ScoreScaledCollateralSizing,
    });

    const transactionCallback = (prisma.$transaction as any).mock.calls[0][0];
    const tx = {
      simulationResearch: {
        create: jest.fn(async () => createdResearch),
        findUniqueOrThrow: jest.fn(async () => createdResearch),
      },
      simulation: {
        createMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    await transactionCallback(tx);

    expect((tx.simulationResearch.create as any).mock.calls[0][0].data).toEqual(
      expect.objectContaining({
        days: 3,
        gapDays: 2,
        collateral: [{ min: 10, max: 500 }],
        leverage: [{ min: 10, max: 50 }],
        score: [{ min: 0.5, max: 0.8 }],
        scoreFormular: SimulationScoreFormular.RiskAdjustedCopyScore,
        sizingFormular: SimulationSizingFormular.ScoreScaledCollateralSizing,
      }),
    );
    expect((tx.simulation.createMany as any).mock.calls[0][0].data[0]).toEqual(
      expect.objectContaining({
        days: 3,
        gapDays: 2,
        totalSimulationPlans: 2,
        collateral: { min: 10, max: 500 },
        leverage: { min: 10, max: 50 },
        score: { min: 0.5, max: 0.8 },
        scoreFormular: SimulationScoreFormular.RiskAdjustedCopyScore,
        sizingFormular: SimulationSizingFormular.ScoreScaledCollateralSizing,
      }),
    );
    expect(result.days).toBe(3);
    expect(result.gapDays).toBe(2);
    expect(result.scoreFormular).toBe(DEFAULT_SCORE_FORMULAR);
    expect(result.sizingFormular).toBe(DEFAULT_SIZING_FORMULAR);
    expect(result.status).toBe(SimulationStatus.Created);
    expect(result.cursor).toBeNull();
    expect(result.progressPhase).toBe('created');
    expect(result.progressMessage).toBe('Research created');
    expect(result.progressPercent).toBe(0);
    expect(result.totalRanges).toBe(2);
    expect(result.completedRanges).toBe(0);
    expect(result.startedAt).toBeNull();
    expect(result.finishedAt).toBeNull();
    expect(result.lastError).toBeNull();
  });

  it('rejects simulation research with more than 30 generated simulations', async () => {
    const prisma = {
      $transaction: jest.fn(),
    };
    const service = new SimulationsService(prisma as never, {} as never);

    await expect(
      service.createSimulationResearch({
        title: 'Oversized research',
        description: 'Too many grid combinations',
        platform: Platform.GNS,
        startAt: new Date('2026-07-01T00:00:00.000Z'),
        endAt: new Date('2026-07-10T00:00:00.000Z'),
        days: 1,
        gapDays: 0,
        direction: BotMode.Reversed,
        trade: [
          { min: 3, max: 10 },
          { min: 11, max: 20 },
        ],
        r2: [
          { min: 0.25, max: 0.5 },
          { min: 0.51, max: 0.75 },
        ],
        slope: [
          { min: 1, max: 3 },
          { min: 4, max: 6 },
        ],
        collateral: [
          { min: 10, max: 500 },
          { min: 501, max: 1000 },
        ],
        leverage: [
          { min: 10, max: 50 },
          { min: 51, max: 75 },
        ],
        score: [{ min: 0.5, max: 0.8 }],
        scoreFormular: SimulationScoreFormular.RiskAdjustedCopyScore,
        sizingFormular: SimulationSizingFormular.ScoreScaledCollateralSizing,
      }),
    ).rejects.toThrow(
      'Simulation research can generate at most 30 simulations',
    );
    expect(prisma.$transaction as any).not.toHaveBeenCalled();
  });

  it('queues created research for automation', async () => {
    const research = createResearchRecord();
    const updated = createResearchRecord({
      status: SimulationStatus.Queued,
      progressPhase: 'queued',
      progressMessage: 'Research queued for analytics automation',
      lastError: null,
    });
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => research),
        update: jest.fn(async () => updated),
      },
    };
    const service = new SimulationsService(prisma as never, {} as never);

    const result = await service.playAutoResearch(91);

    expect((prisma.simulationResearch.update as any).mock.calls[0][0]).toEqual({
      where: { id: 91 },
      data: {
        status: SimulationStatus.Queued,
        lastError: null,
        progressPhase: 'queued',
        progressMessage: 'Research queued for analytics automation',
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });
    expect(result.status).toBe(SimulationStatus.Queued);
  });

  it('pauses queued research automation', async () => {
    const research = createResearchRecord({ status: SimulationStatus.Queued });
    const updated = createResearchRecord({
      status: SimulationStatus.Paused,
      progressPhase: 'paused',
      progressMessage: 'Research automation paused',
    });
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => research),
        update: jest.fn(async () => updated),
      },
    };
    const service = new SimulationsService(prisma as never, {} as never);

    const result = await service.pauseResearch(91);

    expect((prisma.simulationResearch.update as any).mock.calls[0][0]).toEqual({
      where: { id: 91 },
      data: {
        status: SimulationStatus.Paused,
        progressPhase: 'paused',
        progressMessage: 'Research automation paused',
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });
    expect(result.status).toBe(SimulationStatus.Paused);
  });

  it('cancels non-terminal research automation', async () => {
    const research = createResearchRecord({ status: SimulationStatus.Running });
    const updated = createResearchRecord({
      status: SimulationStatus.Cancelled,
      progressPhase: 'cancelled',
      progressMessage: 'Research cancellation requested',
      finishedAt: new Date('2026-07-02T00:00:00.000Z'),
    });
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => research),
        update: jest.fn(async () => updated),
      },
    };
    const service = new SimulationsService(prisma as never, {} as never);

    const result = await service.cancelResearch(91);

    expect((prisma.simulationResearch.update as any).mock.calls[0][0]).toEqual({
      where: { id: 91 },
      data: expect.objectContaining({
        status: SimulationStatus.Cancelled,
        progressPhase: 'cancelled',
        progressMessage: 'Research cancellation requested',
      }),
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });
    expect(result.status).toBe(SimulationStatus.Cancelled);
  });

  it('rejects queueing completed research automation', async () => {
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () =>
          createResearchRecord({ status: SimulationStatus.Completed }),
        ),
        update: jest.fn(),
      },
    };
    const service = new SimulationsService(prisma as never, {} as never);

    await expect(service.playAutoResearch(91)).rejects.toThrow(
      'Cannot queue a completed research',
    );
    expect(prisma.simulationResearch.update as any).not.toHaveBeenCalled();
  });

  it('returns cached simulation plan totals for simulation plan rows', async () => {
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

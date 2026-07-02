import { describe, expect, it, jest } from '@jest/globals';
import dayjs from 'dayjs';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';

import { AnalyticsSimulationsService } from './analytics-simulations.service';

function simulation(
  overrides: Partial<{
    id: number;
    startAt: Date;
    endAt: Date;
    days: number;
    gapDays: number;
    cursor: Date | null;
    status: SimulationStatus;
    updatedAt: Date;
    createdAt: Date;
  }> = {},
) {
  return {
    id: overrides.id ?? 1,
    title: 'Queued simulation',
    description: 'Queued simulation',
    platform: Platform.GNS,
    researchId: null,
    direction: BotMode.Reversed,
    startAt: overrides.startAt ?? new Date('2026-05-01T00:00:00.000Z'),
    endAt: overrides.endAt ?? new Date('2026-10-01T00:00:00.000Z'),
    days: overrides.days ?? 1,
    gapDays: overrides.gapDays ?? 0,
    cursor: overrides.cursor ?? null,
    status: overrides.status ?? SimulationStatus.Paused,
    progressPhase: 'queued',
    progressMessage: 'Simulation queued for analytics automation',
    progressPercent: 0,
    selectedLeaderCount: 10,
    trade: { min: 3, max: 100 },
    r2: { min: 0.5, max: 1 },
    slope: { min: 0, max: 100 },
    standardCollateralUsd: 100,
    maxLeverage: 50,
    totalSimulationPlans: 153,
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
    createdAt: overrides.createdAt ?? new Date('2026-04-01T00:00:00.000Z'),
    updatedAt: overrides.updatedAt ?? new Date('2026-04-01T00:00:00.000Z'),
  };
}

function createService(candidates: ReturnType<typeof simulation>[]) {
  const prisma = {
    simulation: {
      findMany: jest.fn(async () => candidates),
    },
  };
  const runner = {
    isAutoSimulationActive: jest.fn(() => false),
    playQueuedAutoSimulation: jest.fn(async (id: number, _horizon: Date) =>
      simulation({ id, status: SimulationStatus.Running }),
    ),
  };

  return {
    service: new AnalyticsSimulationsService(prisma as never, runner as never),
    prisma,
    runner,
  };
}

describe('AnalyticsSimulationsService', () => {
  it('runs a queued simulation only through the current-day horizon', async () => {
    const { service, runner } = createService([simulation({ id: 11 })]);

    await service.processNextQueuedAutoSimulation(
      new Date('2026-07-01T12:00:00.000Z'),
    );

    expect(runner.playQueuedAutoSimulation.mock.calls[0][0]).toBe(11);
    expect(
      dayjs(runner.playQueuedAutoSimulation.mock.calls[0][1]).format(
        'YYYY-MM-DD',
      ),
    ).toBe('2026-07-01');
  });

  it('skips a running simulation that is not stale', async () => {
    const { service, runner } = createService([
      simulation({
        id: 12,
        status: SimulationStatus.Running,
        updatedAt: new Date('2026-07-01T11:55:00.000Z'),
      }),
    ]);

    const result = await service.processNextQueuedAutoSimulation(
      new Date('2026-07-01T12:00:00.000Z'),
    );

    expect(result).toBeNull();
    expect(runner.playQueuedAutoSimulation).not.toHaveBeenCalled();
  });

  it('pauses a created simulation when cron has no ready historical range yet', async () => {
    const candidate = simulation({
      id: 14,
      status: SimulationStatus.Created,
      startAt: new Date('2026-07-01T00:00:00.000Z'),
      endAt: new Date('2026-07-10T00:00:00.000Z'),
    });
    const prisma = {
      simulation: {
        findMany: jest.fn(async () => [candidate]),
        update: jest.fn(async ({ data }: any) => ({
          ...candidate,
          ...data,
        })),
      },
    };
    const runner = {
      isAutoSimulationActive: jest.fn(() => false),
      playQueuedAutoSimulation: jest.fn(),
    };
    const service = new AnalyticsSimulationsService(
      prisma as never,
      runner as never,
    );

    const result = await service.processNextQueuedAutoSimulation(
      new Date('2026-07-01T12:00:00.000Z'),
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: 14,
        status: SimulationStatus.Paused,
        progressPhase: 'paused',
      }),
    );
    expect(prisma.simulation.update).toHaveBeenCalledWith({
      where: { id: 14 },
      data: expect.objectContaining({
        status: SimulationStatus.Paused,
        progressPhase: 'paused',
      }),
    });
    expect(runner.playQueuedAutoSimulation).not.toHaveBeenCalled();
  });

  it('recovers a stale running simulation after a worker restart', async () => {
    const { service, runner } = createService([
      simulation({
        id: 13,
        status: SimulationStatus.Running,
        updatedAt: new Date('2026-07-01T11:40:00.000Z'),
      }),
    ]);

    await service.processNextQueuedAutoSimulation(
      new Date('2026-07-01T12:00:00.000Z'),
    );

    expect(runner.playQueuedAutoSimulation.mock.calls[0][0]).toBe(13);
    expect(
      dayjs(runner.playQueuedAutoSimulation.mock.calls[0][1]).format(
        'YYYY-MM-DD',
      ),
    ).toBe('2026-07-01');
  });
});

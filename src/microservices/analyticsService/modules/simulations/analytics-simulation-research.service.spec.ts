import { describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';

import { AnalyticsSimulationResearchService } from './analytics-simulation-research.service';

function research(overrides: Record<string, unknown> = {}) {
  return {
    id: 21,
    title: 'Automation research',
    description: 'Research ready for automation',
    platform: Platform.GNS,
    startAt: new Date('2026-07-01T00:00:00.000Z'),
    endAt: new Date('2026-07-10T00:00:00.000Z'),
    days: 1,
    gapDays: 0,
    direction: BotMode.Reversed,
    trade: [{ min: 3, max: 10 }],
    r2: [{ min: 0.5, max: 1 }],
    slope: [{ min: 0, max: 100 }],
    collateral: [{ min: 10, max: 500 }],
    leverage: [{ min: 10, max: 50 }],
    score: [{ min: 0.5, max: 0.8 }],
    scoreFormular: 'RiskAdjustedCopyScore',
    sizingFormular: 'ScoreScaledCollateralSizing',
    cursor: null,
    status: SimulationStatus.Created,
    progressPhase: 'created',
    progressMessage: 'Research created',
    progressPercent: 0,
    totalRanges: 9,
    completedRanges: 0,
    startedAt: null,
    finishedAt: null,
    lastError: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AnalyticsSimulationResearchService', () => {
  it('claims the next created research and delegates it to the research runner', async () => {
    const createdResearch = research({ id: 21 });
    const prisma = {
      simulationResearch: {
        findFirst: jest.fn(async () => createdResearch),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const runner = {
      playAutomaticResearch: jest.fn(async () =>
        research({ id: 21, status: SimulationStatus.Running }),
      ),
    };
    const service = new AnalyticsSimulationResearchService(
      prisma as never,
      runner as never,
    );
    const now = new Date('2026-07-07T12:00:00.000Z');

    const result = await service.processNextAutomaticResearch(now);

    expect(prisma.simulationResearch.findFirst as any).toHaveBeenCalledWith({
      where: {
        status: {
          in: [
            SimulationStatus.Created,
            SimulationStatus.Paused,
            SimulationStatus.Queued,
          ],
        },
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(prisma.simulationResearch.updateMany as any).toHaveBeenCalledWith({
      where: {
        id: 21,
        status: {
          in: [
            SimulationStatus.Created,
            SimulationStatus.Paused,
            SimulationStatus.Queued,
          ],
        },
      },
      data: {
        status: SimulationStatus.Running,
        startedAt: now,
        finishedAt: null,
        lastError: null,
        progressPhase: 'running',
        progressMessage: 'Research automation started',
      },
    });
    expect(runner.playAutomaticResearch as any).toHaveBeenCalledWith(21);
    expect(result).toEqual(expect.objectContaining({ id: 21 }));
  });

  it('resumes paused research automatically', async () => {
    const pausedResearch = research({ id: 23, status: SimulationStatus.Paused });
    const prisma = {
      simulationResearch: {
        findFirst: jest.fn(async () => pausedResearch),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const runner = {
      playAutomaticResearch: jest.fn(async () =>
        research({ id: 23, status: SimulationStatus.Running }),
      ),
    };
    const service = new AnalyticsSimulationResearchService(
      prisma as never,
      runner as never,
    );

    await service.processNextAutomaticResearch();

    expect(runner.playAutomaticResearch as any).toHaveBeenCalledWith(23);
  });

  it('returns null when there is no automatic research', async () => {
    const prisma = {
      simulationResearch: {
        findFirst: jest.fn(async () => null),
        updateMany: jest.fn(),
      },
    };
    const runner = {
      playAutomaticResearch: jest.fn(),
    };
    const service = new AnalyticsSimulationResearchService(
      prisma as never,
      runner as never,
    );

    const result = await service.processNextAutomaticResearch();

    expect(result).toBeNull();
    expect(prisma.simulationResearch.updateMany).not.toHaveBeenCalled();
    expect(runner.playAutomaticResearch).not.toHaveBeenCalled();
  });

  it('does not delegate when another worker already claimed the research', async () => {
    const prisma = {
      simulationResearch: {
        findFirst: jest.fn(async () => research({ id: 22 })),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
    };
    const runner = {
      playAutomaticResearch: jest.fn(),
    };
    const service = new AnalyticsSimulationResearchService(
      prisma as never,
      runner as never,
    );

    const result = await service.processNextAutomaticResearch();

    expect(result).toBeNull();
    expect(runner.playAutomaticResearch).not.toHaveBeenCalled();
  });
});

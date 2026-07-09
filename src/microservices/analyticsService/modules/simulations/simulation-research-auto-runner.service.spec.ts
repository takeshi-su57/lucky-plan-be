import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';

import { SimulationResearchAutoRunnerService } from './simulation-research-auto-runner.service';

describe('SimulationResearchAutoRunnerService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  function createResearch(overrides: Record<string, unknown> = {}) {
    return {
      id: 31,
      title: 'Research',
      description: 'Research runner test',
      platform: Platform.GNS,
      startAt: new Date('2026-07-01T00:00:00.000Z'),
      endAt: new Date('2026-07-04T00:00:00.000Z'),
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
      status: SimulationStatus.Running,
      progressPhase: 'running',
      progressMessage: 'Research automation started',
      progressPercent: 0,
      totalRanges: 0,
      completedRanges: 0,
      startedAt: new Date('2026-07-07T00:00:00.000Z'),
      finishedAt: null,
      lastError: null,
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
      simulations: [
        { id: 101, status: SimulationStatus.Created },
        { id: 102, status: SimulationStatus.Paused },
      ],
      ...overrides,
    };
  }

  it('processes research one range at a time across all child simulations', async () => {
    const timeSpy = jest.spyOn(console, 'time').mockImplementation(() => {});
    const timeEndSpy = jest
      .spyOn(console, 'timeEnd')
      .mockImplementation(() => {});
    const research = createResearch();
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => research),
        update: jest.fn(async ({ data }) => ({ ...research, ...data })),
      },
    };
    const simulationRunner = {
      loadSimulationRangeProcessingContext: jest.fn(async () => ({
        allRanges: [],
        platformContracts: [],
        contractById: new Map(),
      })),
      mapSimulation: jest.fn((record) => record),
      processSimulationRange: jest.fn(async () => ({ status: 'Completed' })),
      aggregateSimulationThroughCursor: jest.fn(async () => undefined),
    };
    const leaderEventLogCacheService = {
      clear: jest.fn(async () => undefined),
      prebuildForResearch: jest.fn(async (...args: unknown[]) => {
        const options = args[3] as {
          onProgress?: (progress: {
            completedAddressBatches: number;
            totalAddressBatches: number;
            completedAddresses: number;
            totalAddresses: number;
          }) => Promise<void>;
        };

        await options.onProgress?.({
          completedAddressBatches: 1,
          totalAddressBatches: 2,
          completedAddresses: 100,
          totalAddresses: 200,
        });
      }),
    };
    const redisClient = { emit: jest.fn(async () => undefined) };
    const service = new SimulationResearchAutoRunnerService(
      prisma as never,
      simulationRunner as never,
      leaderEventLogCacheService as never,
      redisClient as never,
    );

    await service.playAutomaticResearch(31);

    expect(timeSpy).toHaveBeenCalledWith(
      '[simulation:research-auto:31] playAutomaticResearch total',
    );
    expect(timeSpy).toHaveBeenCalledWith(
      '[simulation:research-auto:31] rebuild event-log cache',
    );
    expect(timeSpy).toHaveBeenCalledWith(
      '[simulation:research-auto:31] range 1/3 2026-06-30 total',
    );
    expect(timeEndSpy).toHaveBeenCalledWith(
      '[simulation:research-auto:31] playAutomaticResearch total',
    );
    expect(prisma.simulationResearch.findUnique as any).toHaveBeenCalledWith({
      where: { id: 31 },
      include: {
        simulations: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    expect(leaderEventLogCacheService.clear).toHaveBeenCalledTimes(1);
    expect(leaderEventLogCacheService.prebuildForResearch).toHaveBeenCalledWith(
      Platform.GNS,
      new Date('2026-01-02T00:00:00.000Z'),
      new Date('2026-07-04T00:00:00.000Z'),
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(prisma.simulationResearch.update as any).toHaveBeenCalledWith({
      where: { id: 31 },
      data: {
        progressPhase: 'prebuilding-event-log-cache',
        progressMessage: 'Prebuilding event-log cache 100 / 200 leaders',
        progressPercent: 5,
        totalRanges: 3,
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });
    expect(redisClient.emit).toHaveBeenCalled();
    expect(
      simulationRunner.loadSimulationRangeProcessingContext,
    ).toHaveBeenCalledTimes(1);
    expect(
      simulationRunner.processSimulationRange as any,
    ).toHaveBeenCalledTimes(6);
    expect(
      (simulationRunner.processSimulationRange as any).mock.calls.map(
        (call: unknown[]) => call[0],
      ),
    ).toEqual([101, 102, 101, 102, 101, 102]);
    expect(
      (simulationRunner.processSimulationRange as any).mock.calls.map(
        (call: unknown[]) =>
          (call[1] as { endedAt: Date }).endedAt.toISOString(),
      ),
    ).toEqual([
      '2026-07-01T04:00:00.000Z',
      '2026-07-01T04:00:00.000Z',
      '2026-07-02T04:00:00.000Z',
      '2026-07-02T04:00:00.000Z',
      '2026-07-03T04:00:00.000Z',
      '2026-07-03T04:00:00.000Z',
    ]);
    expect(
      simulationRunner.aggregateSimulationThroughCursor as any,
    ).toHaveBeenCalledTimes(6);
    expect(prisma.simulationResearch.update as any).toHaveBeenLastCalledWith({
      where: { id: 31 },
      data: {
        status: SimulationStatus.Completed,
        cursor: new Date('2026-07-03T04:00:00.000Z'),
        completedRanges: 3,
        totalRanges: 3,
        progressPhase: 'completed',
        progressMessage: 'Research automation completed',
        progressPercent: 100,
        finishedAt: expect.any(Date),
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });
  });

  it('pauses research when no range is ready for the automation horizon', async () => {
    const research = createResearch({
      endAt: new Date('2026-07-09T00:00:00.000Z'),
    });
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => research),
        update: jest.fn(async ({ data }) => ({ ...research, ...data })),
      },
    };
    const simulationRunner = {
      loadSimulationRangeProcessingContext: jest.fn(async () => ({
        allRanges: [],
        platformContracts: [],
        contractById: new Map(),
      })),
      mapSimulation: jest.fn((record) => record),
      processSimulationRange: jest.fn(async () => ({ status: 'Completed' })),
      aggregateSimulationThroughCursor: jest.fn(async () => undefined),
    };
    const leaderEventLogCacheService = {
      clear: jest.fn(async () => undefined),
      prebuildForResearch: jest.fn(async (..._args: unknown[]) => undefined),
    };
    const service = new SimulationResearchAutoRunnerService(
      prisma as never,
      simulationRunner as never,
      leaderEventLogCacheService as never,
    );

    await service.playAutomaticResearch(
      31,
      new Date('2026-06-30T12:00:00.000Z'),
    );

    expect(simulationRunner.processSimulationRange).not.toHaveBeenCalled();
    expect(
      leaderEventLogCacheService.prebuildForResearch,
    ).not.toHaveBeenCalled();
    expect(prisma.simulationResearch.update as any).toHaveBeenCalledWith({
      where: { id: 31 },
      data: {
        status: SimulationStatus.Paused,
        progressPhase: 'paused',
        progressMessage: 'Paused until more historical data is available',
        progressPercent: 0,
        totalRanges: 8,
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';

import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { PATTERNS } from 'src/utils/constants';

describe('SimulationAutoRunnerService queue helpers', () => {
  it('reports whether a simulation id is active locally', () => {
    const service = Object.create(
      SimulationAutoRunnerService.prototype,
    ) as SimulationAutoRunnerService;

    (
      service as unknown as { activeAutoSimulationRunIds: Set<number> }
    ).activeAutoSimulationRunIds = new Set([7]);

    expect(service.isAutoSimulationActive(7)).toBe(true);
    expect(service.isAutoSimulationActive(8)).toBe(false);
  });

  it('uses Paused as the terminal status for a partial queued run', () => {
    expect(
      SimulationAutoRunnerService.getTerminalStatusForHorizon({
        cursor: new Date('2026-07-01T00:00:00.000Z'),
        endAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).toBe(SimulationStatus.Paused);
  });

  it('uses Completed as the terminal status when the cursor reaches endAt', () => {
    expect(
      SimulationAutoRunnerService.getTerminalStatusForHorizon({
        cursor: new Date('2026-10-01T00:00:00.000Z'),
        endAt: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).toBe(SimulationStatus.Completed);
  });

  it('emits simulation and parent research updates for analytics changes', async () => {
    const simulation = {
      id: 4,
      title: 'Research child',
      description: 'Research simulation',
      platform: Platform.GNS,
      researchId: 9,
      direction: BotMode.Reversed,
      startAt: new Date('2026-05-01T00:00:00.000Z'),
      endAt: new Date('2026-06-01T00:00:00.000Z'),
      cursor: null,
      status: SimulationStatus.Running,
      progressPhase: 'accepted',
      progressMessage: 'Auto simulation accepted',
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
    const research = {
      id: 9,
      title: 'Research',
      description: 'Research',
      platform: Platform.GNS,
      startAt: simulation.startAt,
      endAt: simulation.endAt,
      direction: BotMode.Reversed,
      trade: [{ min: 3, max: 100 }],
      r2: [{ min: 0.5, max: 1 }],
      slope: [{ min: 0, max: 100 }],
      maxLeverage: [50],
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
      simulations: [
        { status: SimulationStatus.Completed },
        { status: SimulationStatus.Running },
      ],
    };
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => research),
      },
    };
    const client = {
      emit: jest.fn(async () => undefined),
    };
    const service = new SimulationAutoRunnerService(
      prisma as never,
      {} as never,
      {} as never,
      client as never,
    );

    await service.emitSimulationUpdated(simulation as never);

    expect(client.emit.mock.calls).toContainEqual([
      PATTERNS.Simulations.SimulationUpdated,
      expect.objectContaining({ id: 4, researchId: 9 }),
    ]);
    expect(client.emit.mock.calls).toContainEqual([
      PATTERNS.Simulations.SimulationResearchUpdated,
      expect.objectContaining({
        id: 9,
        totalSimulations: 2,
        completedSimulations: 1,
      }),
    ]);
  });

  it('creates one simulation bot per selected leader platform instead of per contract', async () => {
    const prisma = {
      simulationBot: {
        count: jest.fn(async () => 0),
        createMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => [{ id: 77 }]),
      },
      perpTradingEventLog: {
        groupBy: jest.fn(async () => [
          { address: '0xabc', contractId: 11 },
          { address: '0xabc', contractId: 12 },
        ]),
      },
    };
    const cacheService = {
      ensureSimulationBotCache: jest.fn(async () => undefined),
      refreshIncompleteBotsForPlan: jest.fn(async () => undefined),
    };
    const service = new SimulationAutoRunnerService(
      prisma as never,
      cacheService as never,
      {} as never,
      { emit: jest.fn(async () => undefined) } as never,
    );

    await (service as any).createSimulationBotsForSelections(
      5,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
      {
        id: 9,
        platform: Platform.GNS,
        direction: BotMode.Reversed,
        maxLeverage: 5,
      },
      [
        {
          leaderAddress: '0xabc',
          suggestedRatio: 3,
        },
      ],
      [
        { id: 11, platform: Platform.GNS },
        { id: 12, platform: Platform.GNS },
      ],
    );

    expect((prisma.simulationBot.createMany as any).mock.calls[0][0]).toEqual({
      data: [
        {
          leaderAddress: '0xabc',
          leaderPlatform: Platform.GNS,
          simulationPlanId: 5,
          startedAt: new Date('2026-04-01T00:00:00.000Z'),
          stoppedAt: new Date('2026-04-02T00:00:00.000Z'),
          mode: BotMode.Reversed,
          ratio: 3,
          maxLeverage: 5,
        },
      ],
      skipDuplicates: true,
    });
  });
});

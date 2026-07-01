import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';

import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { PATTERNS } from 'src/utils/constants';

describe('SimulationAutoRunnerService queue helpers', () => {
  const emitClient = {
    emit: jest.fn(async () => undefined),
  };

  const simulationPlan = {
    id: 5,
    title: 'Plan',
    description: 'Plan',
    startAt: new Date('2026-04-01T00:00:00.000Z'),
    endAt: new Date('2026-04-02T00:00:00.000Z'),
    cursor: new Date('2026-04-02T00:00:00.000Z'),
    simulationId: 9,
    simulationBots: [],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

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

  it('uses Completed when the cursor reaches the final executable range before endAt', () => {
    expect(
      SimulationAutoRunnerService.getTerminalStatusForHorizon({
        cursor: new Date('2026-07-09T00:00:00.000Z'),
        endAt: new Date('2026-07-10T00:00:00.000Z'),
        completedPlans: 2,
        totalSimulationPlans: 2,
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
      simulationPlan: {
        findUnique: jest.fn(async () => simulationPlan),
      },
      simulationBot: {
        count: jest.fn(async () => 0),
        createMany: jest.fn(async () => ({ count: 1 })),
        findMany: jest.fn(async () => [{ id: 77 }]),
      },
      perpTradingEventLog: {
        groupBy: jest.fn(),
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
      emitClient as never,
    );

    await (service as any).createSimulationBotsForSelections(
      5,
      new Date('2026-04-01T00:00:00.000Z'),
      new Date('2026-04-02T00:00:00.000Z'),
      {
        id: 9,
        platform: Platform.GNS,
        direction: BotMode.Reversed,
        leverage: { min: 1, max: 5 },
      },
      [
        {
          leaderAddress: '0xabc',
          score: 0.82,
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
          score: 0.82,
          minLeverage: 1,
          maxLeverage: 5,
        },
      ],
      skipDuplicates: true,
    });
    expect(prisma.perpTradingEventLog.groupBy).not.toHaveBeenCalled();
    expect(
      cacheService.refreshIncompleteBotsForPlan as jest.Mock,
    ).toHaveBeenCalledWith(5);
    expect(emitClient.emit as jest.Mock).toHaveBeenCalledWith(
      PATTERNS.Simulations.SimulationPlanUpdated,
      simulationPlan,
    );
  });

  it('evaluates the first plan directly and carries leaders into the next plan', async () => {
    const simulation = {
      id: 10,
      title: 'Windowed simulation',
      description: 'Windowed simulation',
      platform: Platform.GNS,
      researchId: null,
      direction: BotMode.Reversed,
      startAt: new Date('2026-04-01T00:00:00.000Z'),
      endAt: new Date('2026-04-03T00:00:00.000Z'),
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
      totalSimulationPlans: 2,
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
    const latestSimulation = {
      ...simulation,
      cursor: new Date('2026-04-03T00:00:00.000Z'),
    };
    const prisma = {
      simulation: {
        findUnique: (jest.fn() as any)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(latestSimulation),
        update: jest.fn(async ({ data }: any) => ({
          ...simulation,
          ...data,
        })),
      },
      contract: {
        findMany: jest.fn(async () => [
          {
            id: 11,
            platform: Platform.GNS,
            chainId: 1,
            version: 'V9',
          },
        ]),
      },
    };
    const evaluator = {
      findCandidateLeaders: (jest.fn() as any).mockResolvedValueOnce([
        '0xday1',
      ]),
      findChangedLeaderAddresses: (jest.fn() as any).mockResolvedValueOnce([
        '0xday2',
      ]),
      evaluateLeadersForRange: (jest.fn() as any)
        .mockResolvedValueOnce([
          {
            leaderAddress: '0xday1',
            score: 0.7,
            lastEventAt: new Date('2026-03-31T00:00:00.000Z'),
          },
        ])
        .mockResolvedValueOnce([
          {
            leaderAddress: '0xday2',
            score: 0.9,
            lastEventAt: new Date('2026-04-01T12:00:00.000Z'),
          },
        ]),
      getLastEventAtByLeader: jest.fn(async () => new Map()),
    };
    const service = new SimulationAutoRunnerService(
      prisma as never,
      {} as never,
      evaluator as never,
      { emit: jest.fn(async () => undefined) } as never,
    );
    const createSimulationPlanForRange = jest
      .spyOn(service as any, 'createSimulationPlanForRange')
      .mockResolvedValueOnce({ id: 101 })
      .mockResolvedValueOnce({ id: 102 });
    const createSimulationBotsForSelections = jest
      .spyOn(service as any, 'createSimulationBotsForSelections')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'aggregateSimulation')
      .mockResolvedValue(undefined);

    await (service as any).runAutoSimulation(10, {
      mode: 'queue',
      horizon: new Date('2026-04-03T00:00:00.000Z'),
      runInBackground: false,
    });

    expect(createSimulationPlanForRange).toHaveBeenCalledTimes(2);
    expect(evaluator.findCandidateLeaders).toHaveBeenCalledTimes(1);
    expect(evaluator.findChangedLeaderAddresses).toHaveBeenCalledTimes(1);
    expect(evaluator.evaluateLeadersForRange).toHaveBeenCalledTimes(2);
    expect(evaluator.evaluateLeadersForRange.mock.calls[0][1]).toEqual([
      '0xday1',
    ]);
    expect(evaluator.evaluateLeadersForRange.mock.calls[0][2]).toBe(
      createSimulationPlanForRange.mock.calls[0][1],
    );
    expect(evaluator.evaluateLeadersForRange.mock.calls[1][1]).toEqual([
      '0xday2',
    ]);
    expect(evaluator.evaluateLeadersForRange.mock.calls[1][2]).toBe(
      createSimulationPlanForRange.mock.calls[1][1],
    );
    expect(createSimulationBotsForSelections.mock.calls[0][4]).toEqual([
      expect.objectContaining({ leaderAddress: '0xday1', score: 0.7 }),
    ]);
    expect(createSimulationBotsForSelections.mock.calls[1][4]).toEqual([
      expect.objectContaining({ leaderAddress: '0xday2', score: 0.9 }),
      expect.objectContaining({ leaderAddress: '0xday1', score: 0.7 }),
    ]);
  });

  it('carries leaders forward and only re-evaluates addresses changed since the previous plan start', async () => {
    const simulation = {
      id: 13,
      title: 'Dynamic simulation',
      description: 'Dynamic simulation',
      platform: Platform.GNS,
      researchId: null,
      direction: BotMode.Reversed,
      startAt: new Date('2026-04-01T00:00:00.000Z'),
      endAt: new Date('2026-04-04T00:00:00.000Z'),
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
      totalSimulationPlans: 3,
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
    const latestSimulation = {
      ...simulation,
      cursor: new Date('2026-04-04T00:00:00.000Z'),
      completedPlans: 3,
    };
    const prisma = {
      simulation: {
        findUnique: (jest.fn() as any)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(latestSimulation),
        update: jest.fn(async ({ data }: any) => ({
          ...simulation,
          ...data,
        })),
      },
      contract: {
        findMany: jest.fn(async () => [
          {
            id: 11,
            platform: Platform.GNS,
            chainId: 1,
            version: 'V9',
          },
        ]),
      },
    };
    const evaluator = {
      findCandidateLeaders: jest.fn(async () => [
        '0xcarry',
        '0xstale',
        '0xchanged',
      ]),
      findChangedLeaderAddresses: (jest.fn() as any)
        .mockResolvedValueOnce(['0xchanged', '0xnew'])
        .mockResolvedValueOnce([]),
      evaluateLeadersForRange: (jest.fn() as any)
        .mockResolvedValueOnce([
          {
            leaderAddress: '0xcarry',
            score: 0.7,
            suggestedRatio: 1,
            lastEventAt: new Date('2026-03-20T00:00:00.000Z'),
          },
          {
            leaderAddress: '0xstale',
            score: 0.6,
            suggestedRatio: 1,
            lastEventAt: new Date('2026-02-20T00:00:00.000Z'),
          },
          {
            leaderAddress: '0xchanged',
            score: 0.8,
            suggestedRatio: 1,
            lastEventAt: new Date('2026-03-25T00:00:00.000Z'),
          },
        ])
        .mockResolvedValueOnce([
          {
            leaderAddress: '0xnew',
            score: 0.9,
            suggestedRatio: 1,
            lastEventAt: new Date('2026-04-01T12:00:00.000Z'),
          },
        ]),
      getLastEventAtByLeader: jest.fn(async () => new Map()),
    };
    const service = new SimulationAutoRunnerService(
      prisma as never,
      {} as never,
      evaluator as never,
      { emit: jest.fn(async () => undefined) } as never,
    );
    jest
      .spyOn(service as any, 'createSimulationPlanForRange')
      .mockResolvedValueOnce({ id: 301 })
      .mockResolvedValueOnce({ id: 302 })
      .mockResolvedValueOnce({ id: 303 });
    const createSimulationBotsForSelections = jest
      .spyOn(service as any, 'createSimulationBotsForSelections')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'aggregateSimulation')
      .mockResolvedValue(undefined);

    await (service as any).runAutoSimulation(13, {
      mode: 'queue',
      horizon: new Date('2026-04-04T00:00:00.000Z'),
      runInBackground: false,
    });

    expect(evaluator.findCandidateLeaders).toHaveBeenCalledTimes(1);
    expect(evaluator.findChangedLeaderAddresses).toHaveBeenCalledTimes(2);
    expect(evaluator.findChangedLeaderAddresses.mock.calls[0][1]).toEqual({
      startedAt: new Date('2026-04-01T00:00:00.000Z'),
      endedAt: new Date('2026-04-02T00:00:00.000Z'),
    });
    expect(evaluator.evaluateLeadersForRange.mock.calls[1][1]).toEqual([
      '0xchanged',
      '0xnew',
    ]);
    expect(createSimulationBotsForSelections.mock.calls[0][4]).toEqual([
      expect.objectContaining({ leaderAddress: '0xchanged', score: 0.8 }),
      expect.objectContaining({ leaderAddress: '0xcarry', score: 0.7 }),
    ]);
    expect(createSimulationBotsForSelections.mock.calls[1][4]).toEqual([
      expect.objectContaining({ leaderAddress: '0xnew', score: 0.9 }),
      expect.objectContaining({ leaderAddress: '0xcarry', score: 0.7 }),
    ]);
    expect(createSimulationBotsForSelections.mock.calls[2][4]).toEqual([
      expect.objectContaining({ leaderAddress: '0xnew', score: 0.9 }),
      expect.objectContaining({ leaderAddress: '0xcarry', score: 0.7 }),
    ]);
  });

  it('seeds carried leaders from the previous persisted plan when a queued simulation resumes mid-run', async () => {
    const simulation = {
      id: 14,
      title: 'Resumed dynamic simulation',
      description: 'Resumed dynamic simulation',
      platform: Platform.GNS,
      researchId: null,
      direction: BotMode.Reversed,
      startAt: new Date('2026-04-01T00:00:00.000Z'),
      endAt: new Date('2026-04-04T00:00:00.000Z'),
      cursor: new Date('2026-04-02T00:00:00.000Z'),
      status: SimulationStatus.Paused,
      progressPhase: 'paused',
      progressMessage: 'Paused',
      progressPercent: 33,
      selectedLeaderCount: 10,
      trade: { min: 3, max: 100 },
      r2: { min: 0.5, max: 1 },
      slope: { min: 0, max: 100 },
      standardCollateralUsd: 100,
      maxLeverage: 50,
      totalSimulationPlans: 3,
      completedPlans: 1,
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
      updatedAt: new Date('2026-04-02T00:00:00.000Z'),
    };
    const latestSimulation = {
      ...simulation,
      cursor: new Date('2026-04-03T00:00:00.000Z'),
      completedPlans: 2,
    };
    const prisma = {
      simulation: {
        findUnique: (jest.fn() as any)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(latestSimulation),
        update: jest.fn(async ({ data }: any) => ({
          ...simulation,
          ...data,
        })),
      },
      contract: {
        findMany: jest.fn(async () => [
          {
            id: 11,
            platform: Platform.GNS,
            chainId: 1,
            version: 'V9',
          },
        ]),
      },
      simulationPlan: {
        findFirst: jest.fn(async () => ({
          id: 401,
          startAt: new Date('2026-04-01T00:00:00.000Z'),
          endAt: new Date('2026-04-02T00:00:00.000Z'),
          simulationBots: [
            {
              leaderAddress: '0xcarry',
              score: 0.7,
              ratio: 2,
              leaderPlatform: Platform.GNS,
            },
          ],
        })),
      },
    };
    const evaluator = {
      findCandidateLeaders: jest.fn(async () => ['0xshould-not-run']),
      findChangedLeaderAddresses: (jest.fn() as any).mockResolvedValue([
        '0xnew',
      ]),
      evaluateLeadersForRange: jest.fn(async () => [
        {
          leaderAddress: '0xnew',
          score: 0.9,
          suggestedRatio: 1,
          lastEventAt: new Date('2026-04-02T12:00:00.000Z'),
        },
      ]),
      getLastEventAtByLeader: jest.fn(
        async () =>
          new Map([['0xcarry', new Date('2026-04-01T12:00:00.000Z')]]),
      ),
    };
    const service = new SimulationAutoRunnerService(
      prisma as never,
      {} as never,
      evaluator as never,
      { emit: jest.fn(async () => undefined) } as never,
    );
    jest
      .spyOn(service as any, 'createSimulationPlanForRange')
      .mockResolvedValueOnce({ id: 402 });
    const createSimulationBotsForSelections = jest
      .spyOn(service as any, 'createSimulationBotsForSelections')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'aggregateSimulation')
      .mockResolvedValue(undefined);

    await (service as any).runAutoSimulation(14, {
      mode: 'queue',
      horizon: new Date('2026-04-03T00:00:00.000Z'),
      runInBackground: false,
    });

    expect(evaluator.findCandidateLeaders).not.toHaveBeenCalled();
    expect(evaluator.findChangedLeaderAddresses).toHaveBeenCalledWith(
      expect.objectContaining({ id: 14 }),
      {
        startedAt: new Date('2026-04-01T00:00:00.000Z'),
        endedAt: new Date('2026-04-02T00:00:00.000Z'),
      },
    );
    expect(createSimulationBotsForSelections.mock.calls[0][4]).toEqual([
      expect.objectContaining({ leaderAddress: '0xnew', score: 0.9 }),
      expect.objectContaining({
        leaderAddress: '0xcarry',
        score: 0.7,
        suggestedRatio: 2,
      }),
    ]);
  });

  it('resumes incrementally from an empty previous persisted leader list', async () => {
    const simulation = {
      id: 15,
      title: 'Empty resume simulation',
      description: 'Empty resume simulation',
      platform: Platform.GNS,
      researchId: null,
      direction: BotMode.Reversed,
      startAt: new Date('2026-04-01T00:00:00.000Z'),
      endAt: new Date('2026-04-04T00:00:00.000Z'),
      cursor: new Date('2026-04-02T00:00:00.000Z'),
      status: SimulationStatus.Paused,
      progressPhase: 'paused',
      progressMessage: 'Paused',
      progressPercent: 33,
      selectedLeaderCount: 10,
      trade: { min: 3, max: 100 },
      r2: { min: 0.5, max: 1 },
      slope: { min: 0, max: 100 },
      standardCollateralUsd: 100,
      maxLeverage: 50,
      totalSimulationPlans: 3,
      completedPlans: 1,
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
      updatedAt: new Date('2026-04-02T00:00:00.000Z'),
    };
    const latestSimulation = {
      ...simulation,
      cursor: new Date('2026-04-03T00:00:00.000Z'),
      completedPlans: 2,
    };
    const prisma = {
      simulation: {
        findUnique: (jest.fn() as any)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(latestSimulation),
        update: jest.fn(async ({ data }: any) => ({
          ...simulation,
          ...data,
        })),
      },
      contract: {
        findMany: jest.fn(async () => [
          {
            id: 11,
            platform: Platform.GNS,
            chainId: 1,
            version: 'V9',
          },
        ]),
      },
      simulationPlan: {
        findFirst: jest.fn(async () => ({
          id: 501,
          startAt: new Date('2026-04-01T00:00:00.000Z'),
          endAt: new Date('2026-04-02T00:00:00.000Z'),
          simulationBots: [],
        })),
      },
    };
    const evaluator = {
      findCandidateLeaders: jest.fn(async () => ['0xshould-not-run']),
      findChangedLeaderAddresses: (jest.fn() as any).mockResolvedValue([
        '0xnew',
      ]),
      evaluateLeadersForRange: jest.fn(async () => [
        {
          leaderAddress: '0xnew',
          score: 0.9,
          suggestedRatio: 1,
          lastEventAt: new Date('2026-04-02T12:00:00.000Z'),
        },
      ]),
      getLastEventAtByLeader: jest.fn(async () => new Map()),
    };
    const service = new SimulationAutoRunnerService(
      prisma as never,
      {} as never,
      evaluator as never,
      { emit: jest.fn(async () => undefined) } as never,
    );
    jest
      .spyOn(service as any, 'createSimulationPlanForRange')
      .mockResolvedValueOnce({ id: 502 });
    const createSimulationBotsForSelections = jest
      .spyOn(service as any, 'createSimulationBotsForSelections')
      .mockResolvedValue(undefined);
    jest
      .spyOn(service as any, 'aggregateSimulation')
      .mockResolvedValue(undefined);

    await (service as any).runAutoSimulation(15, {
      mode: 'queue',
      horizon: new Date('2026-04-03T00:00:00.000Z'),
      runInBackground: false,
    });

    expect(evaluator.findCandidateLeaders).not.toHaveBeenCalled();
    expect(evaluator.findChangedLeaderAddresses).toHaveBeenCalledWith(
      expect.objectContaining({ id: 15 }),
      {
        startedAt: new Date('2026-04-01T00:00:00.000Z'),
        endedAt: new Date('2026-04-02T00:00:00.000Z'),
      },
    );
    expect(createSimulationBotsForSelections.mock.calls[0][4]).toEqual([
      expect.objectContaining({ leaderAddress: '0xnew', score: 0.9 }),
    ]);
  });

  it('completes a gap-day simulation after the final generated range runs before endAt', async () => {
    const simulation = {
      id: 12,
      title: 'Gapped simulation',
      description: 'Gapped simulation',
      platform: Platform.GNS,
      researchId: null,
      direction: BotMode.Reversed,
      startAt: new Date('2026-07-01T00:00:00.000Z'),
      endAt: new Date('2026-07-10T00:00:00.000Z'),
      days: 3,
      gapDays: 2,
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
      totalSimulationPlans: 2,
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
      createdAt: new Date('2026-07-01T00:00:00.000Z'),
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    };
    const latestSimulation = {
      ...simulation,
      cursor: new Date('2026-07-09T00:00:00.000Z'),
      completedPlans: 2,
    };
    const prisma = {
      simulation: {
        findUnique: (jest.fn() as any)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(simulation)
          .mockResolvedValueOnce(latestSimulation),
        update: jest.fn(async ({ data }: any) => ({
          ...simulation,
          ...data,
        })),
      },
      contract: {
        findMany: jest.fn(async () => [
          {
            id: 11,
            platform: Platform.GNS,
            chainId: 1,
            version: 'V9',
          },
        ]),
      },
    };
    const evaluator = {
      findCandidateLeaders: jest.fn(async () => []),
      evaluateLeadersForRange: jest.fn(async () => []),
      findChangedLeaderAddresses: jest.fn(async () => []),
      getLastEventAtByLeader: jest.fn(async () => new Map()),
    };
    const service = new SimulationAutoRunnerService(
      prisma as never,
      {} as never,
      evaluator as never,
      emitClient as never,
    );
    jest
      .spyOn(service as any, 'createSimulationPlanForRange')
      .mockResolvedValue({ id: 201 });
    jest
      .spyOn(service as any, 'createSimulationBotsForSelections')
      .mockResolvedValue(undefined);
    const aggregateSimulation = jest
      .spyOn(service as any, 'aggregateSimulation')
      .mockResolvedValue(undefined);

    await (service as any).runAutoSimulation(12, {
      mode: 'queue',
      horizon: new Date('2026-07-10T00:00:00.000Z'),
      runInBackground: false,
    });

    expect(aggregateSimulation).toHaveBeenCalledWith(12, {
      status: SimulationStatus.Completed,
      through: new Date('2026-07-09T00:00:00.000Z'),
    });
  });
});

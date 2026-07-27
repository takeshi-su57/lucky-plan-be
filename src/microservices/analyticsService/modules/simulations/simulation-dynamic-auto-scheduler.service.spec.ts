import { describe, expect, it, jest } from '@jest/globals';
import { SimulationExecutionPlanStatus } from 'generated/prisma/enums';

import {
  calculateEvaluatorQueueRefill,
  SimulationDynamicAutoSchedulerService,
} from './simulation-dynamic-auto-scheduler.service';

describe('calculateEvaluatorQueueRefill', () => {
  it('fills an empty queue to three times fleet capacity', () => {
    expect(calculateEvaluatorQueueRefill(48, 0, 28, 500)).toBe(144);
  });

  it('refills from exactly two times fleet capacity to three times capacity', () => {
    expect(calculateEvaluatorQueueRefill(48, 96, 124, 500)).toBe(48);
  });

  it('does not refill while the queue is above two times fleet capacity', () => {
    expect(calculateEvaluatorQueueRefill(48, 97, 124, 500)).toBe(0);
  });

  it('tops a depleted queue back up to the high watermark', () => {
    expect(calculateEvaluatorQueueRefill(48, 95, 123, 500)).toBe(49);
  });

  it('respects the global outstanding-plan safety ceiling', () => {
    expect(calculateEvaluatorQueueRefill(48, 0, 490, 500)).toBe(10);
  });

  it('applies backpressure when finalization is saturated', () => {
    expect(calculateEvaluatorQueueRefill(48, 0, 200, 500, 200, 200)).toBe(0);
  });
});

describe('failed evaluator reconciliation', () => {
  it('guards the retry increment with the dispatched status', async () => {
    const updateMany = jest
      .fn<(...args: any[]) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const prisma = {
      simulation: {
        updateMany: jest
          .fn<(...args: any[]) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 0 }),
      },
      simulationExecutionPlan: {
        updateMany,
        findMany: jest
          .fn<() => Promise<Array<{ id: string }>>>()
          .mockResolvedValue([{ id: 'plan-1' }]),
      },
    };
    const scheduler = new SimulationDynamicAutoSchedulerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await (
      scheduler as unknown as {
        reconcileInterruptedPlans(now: Date): Promise<void>;
      }
    ).reconcileInterruptedPlans(new Date('2026-07-23T00:00:00.000Z'));

    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          id: 'plan-1',
          status: SimulationExecutionPlanStatus.Dispatched,
        },
      }),
    );
  });

  it('releases an orphaned materializer lease after the grace period', async () => {
    const releaseLease = jest
      .fn<(...args: any[]) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 2 });
    const logger = { log: jest.fn(async () => undefined) };
    const prisma = {
      simulation: { updateMany: releaseLease },
      simulationExecutionPlan: {
        updateMany: jest
          .fn<(...args: any[]) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 0 }),
        findMany: jest
          .fn<() => Promise<Array<{ id: string }>>>()
          .mockResolvedValue([]),
      },
    };
    const scheduler = new SimulationDynamicAutoSchedulerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never,
      {} as never,
    );
    const now = new Date('2026-07-26T00:00:00.000Z');

    await (
      scheduler as unknown as {
        reconcileInterruptedPlans(now: Date): Promise<void>;
      }
    ).reconcileInterruptedPlans(now);

    const orphanRecoveryCall = releaseLease.mock.calls[0][0];
    expect(orphanRecoveryCall.where.sourceSimulationId).toBeNull();
    expect(orphanRecoveryCall.where.executionPlans.some.status).toBe(
      SimulationExecutionPlanStatus.Dispatched,
    );
    expect(orphanRecoveryCall.data.automationLeaseToken).toBeNull();
    expect(logger.log).toHaveBeenCalled();
  });
});

describe('research completion reconciliation', () => {
  it('does not complete a simulation whose materialized plans await event logs', async () => {
    const simulationUpdate = jest.fn(async () => undefined);
    const prisma = {
      simulation: {
        findMany: jest.fn(async () => [
          {
            id: 1,
            status: 'Running',
            completedPlans: 0,
            totalSimulationPlans: 2,
            executionPlans: [
              { status: SimulationExecutionPlanStatus.AwaitingEventLogs },
              { status: SimulationExecutionPlanStatus.AwaitingEventLogs },
            ],
          },
        ]),
        update: simulationUpdate,
        findFirst: jest.fn(async () => null),
      },
      simulationResearch: {
        findUnique: jest.fn(async () => ({
          simulations: [
            {
              totalSimulationPlans: 2,
              completedPlans: 0,
              executionPlans: [
                {
                  status: SimulationExecutionPlanStatus.AwaitingEventLogs,
                  createdAt: new Date(),
                  dispatchedAt: null,
                  completedAt: null,
                  evaluatorTask: null,
                },
              ],
            },
          ],
        })),
        update: jest.fn(async () => undefined),
      },
    };
    const scheduler = new SimulationDynamicAutoSchedulerService(
      prisma as never,
      { emitSimulationUpdated: jest.fn(async () => undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await (
      scheduler as unknown as {
        syncResearch(researchId: number): Promise<void>;
      }
    ).syncResearch(42);

    expect(simulationUpdate).not.toHaveBeenCalled();
  });

  it('reopens a prematurely completed simulation so Layer 3 can finish it', async () => {
    const simulationUpdate = jest
      .fn<(...args: any[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    const prisma = {
      simulation: {
        findMany: jest.fn(async () => [
          {
            id: 1,
            status: 'Completed',
            completedPlans: 2,
            totalSimulationPlans: 2,
            executionPlans: [
              { status: SimulationExecutionPlanStatus.AwaitingEventLogs },
              { status: SimulationExecutionPlanStatus.AwaitingEventLogs },
            ],
          },
        ]),
        update: simulationUpdate,
        findFirst: jest.fn(async () => null),
      },
      simulationResearch: {
        findUnique: jest.fn(async () => ({
          simulations: [
            {
              totalSimulationPlans: 2,
              completedPlans: 0,
              executionPlans: [
                {
                  status: SimulationExecutionPlanStatus.AwaitingEventLogs,
                  createdAt: new Date(),
                  dispatchedAt: null,
                  completedAt: null,
                  evaluatorTask: null,
                },
              ],
            },
          ],
        })),
        update: jest.fn(async () => undefined),
      },
    };
    const scheduler = new SimulationDynamicAutoSchedulerService(
      prisma as never,
      { emitSimulationUpdated: jest.fn(async () => undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await (
      scheduler as unknown as {
        syncResearch(researchId: number): Promise<void>;
      }
    ).syncResearch(42);

    expect(simulationUpdate.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        where: { id: 1 },
        data: expect.objectContaining({
          status: 'Running',
          completedPlans: 0,
          progressPhase: 'awaiting-event-logs',
        }),
      }),
    );
  });
});

describe('materialized simulation finalization', () => {
  it('claims ready simulations up to finalizer concurrency', async () => {
    const candidates = [1, 2, 3].map((id) => ({
      id,
      researchId: 42,
      totalSimulationPlans: 2,
      executionPlans: [
        {
          id: `${id}-1`,
          status: SimulationExecutionPlanStatus.AwaitingEventLogs,
        },
        {
          id: `${id}-2`,
          status: SimulationExecutionPlanStatus.AwaitingEventLogs,
        },
      ],
    }));
    const updateMany = jest
      .fn<(...args: any[]) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const finalizeMaterializedSimulation = jest
      .fn<
        (
          simulationId: number,
        ) => Promise<{ simulation: null; awaitingEventLogs: boolean }>
      >()
      .mockResolvedValue({
        simulation: null,
        awaitingEventLogs: true,
      });
    const findMany = jest
      .fn<(...args: any[]) => Promise<typeof candidates>>()
      .mockResolvedValue(candidates);
    const prisma = {
      simulation: {
        findFirst: jest.fn(async () => null),
        findMany,
        updateMany,
      },
    };
    const scheduler = new SimulationDynamicAutoSchedulerService(
      prisma as never,
      { finalizeMaterializedSimulation } as never,
      {} as never,
      {} as never,
      {} as never,
      {
        get: jest.fn(async () => ({ finalizerConcurrency: 2 })),
      } as never,
    );

    await scheduler.finalizeMaterializedSimulations(
      new Date('2026-07-26T00:00:00.000Z'),
    );

    expect(finalizeMaterializedSimulation).toHaveBeenCalledTimes(2);
    expect(finalizeMaterializedSimulation).toHaveBeenNthCalledWith(1, 1);
    expect(finalizeMaterializedSimulation).toHaveBeenNthCalledWith(2, 2);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('does not finalize a derived simulation before its source completes', async () => {
    const findFirst = jest
      .fn<(...args: any[]) => Promise<null>>()
      .mockResolvedValue(null);
    const prisma = {
      simulation: {
        findFirst,
        findMany: jest.fn(async () => []),
      },
    };
    const scheduler = new SimulationDynamicAutoSchedulerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {
        get: jest.fn(async () => ({ finalizerConcurrency: 2 })),
      } as never,
    );

    await scheduler.finalizeMaterializedSimulations(
      new Date('2026-07-26T00:00:00.000Z'),
    );

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceSimulation: {
            is: { status: 'Completed' },
          },
        }),
      }),
    );
  });

  it('includes legacy completed derived research with zero finalizer counters in reconciliation', async () => {
    const findMany = jest.fn<(...args: any[]) => Promise<any>>(async () => []);
    const scheduler = new SimulationDynamicAutoSchedulerService(
      { simulationResearch: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await (scheduler as any).reconcileResearchProgress();

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            {
              sourceSimulationId: { not: null },
              status: 'Completed',
              totalPlans: { gt: 0 },
              finalizedPlans: 0,
            },
          ]),
        }),
      }),
    );
  });

  it('propagates a derived child failure to its research', async () => {
    const researchUpdate = jest.fn<(...args: any[]) => Promise<any>>(
      async () => undefined,
    );
    const scheduler = new SimulationDynamicAutoSchedulerService(
      {
        simulation: {
          findMany: jest.fn(async () => [
            {
              id: 7,
              status: 'Failed',
              completedPlans: 0,
              totalSimulationPlans: 1,
              executionPlans: [],
            },
          ]),
        },
        simulationResearch: {
          findUnique: jest.fn(async () => ({
            id: 3,
            sourceSimulationId: 1,
            simulations: [
              {
                status: 'Failed',
                error: 'snapshot failed',
                totalSimulationPlans: 1,
                completedPlans: 0,
                _count: { simulationPlans: 1 },
                executionPlans: [],
              },
            ],
          })),
          update: researchUpdate,
        },
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await (scheduler as any).syncResearch(3);

    expect(researchUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 3 },
        data: expect.objectContaining({
          status: 'Failed',
          progressPhase: 'source-derived-failed',
          lastError: 'snapshot failed',
        }),
      }),
    );
  });
});

describe('dynamic dispatch selection', () => {
  it('dispatches the oldest ready simulation when an older one has no ready range', async () => {
    const noRangeSimulation = {
      id: 1,
      researchId: 10,
      platform: 'AVNT',
      startAt: new Date('2025-01-01T00:00:00.000Z'),
      endAt: new Date('2025-01-01T00:00:00.000Z'),
      days: 1,
      gapDays: 0,
      executionPlans: [],
      research: { startedAt: null },
    };
    const readySimulation = {
      ...noRangeSimulation,
      id: 2,
      researchId: 11,
      startAt: new Date('2025-01-01T00:00:00.000Z'),
      endAt: new Date('2025-01-03T00:00:00.000Z'),
    };
    const upsert = jest
      .fn<(...args: any[]) => Promise<any>>()
      .mockResolvedValue({
        id: 'plan-1',
        status: SimulationExecutionPlanStatus.Pending,
        attempts: 0,
      });
    const prisma = {
      simulation: {
        findMany: jest.fn(async () => [noRangeSimulation, readySimulation]),
        update: jest.fn(),
      },
      simulationExecutionPlan: {
        count: jest.fn(async () => 0),
        upsert,
        update: jest.fn(),
      },
      simulationEvaluatorTask: { count: jest.fn(async () => 0) },
      simulationResearch: { update: jest.fn() },
      $transaction: jest.fn(async () => undefined),
    };
    const runner = {
      findCandidateLeadersForRange: jest.fn(async () => ({
        simulation: readySimulation,
        candidateLeaders: [],
      })),
      loadSimulationRangeProcessingContext: jest.fn(async () => ({
        contractById: new Map(),
      })),
    };
    const scheduler = new SimulationDynamicAutoSchedulerService(
      prisma as never,
      runner as never,
      {
        enqueueLeadersForRange: jest.fn(async () => ({ id: 'task-1' })),
      } as never,
      { countReadyWorkers: jest.fn(async () => 1) } as never,
      {} as never,
      {
        get: jest.fn(async () => ({
          maxOutstandingDynamicPlans: 500,
          maxAwaitingFinalizationPlans: 200,
        })),
      } as never,
    );
    jest.spyOn(scheduler as any, 'syncResearch').mockResolvedValue(undefined);

    await (
      scheduler as unknown as {
        fillEvaluatorQueue(now: Date): Promise<void>;
      }
    ).fillEvaluatorQueue(new Date('2025-01-03T00:00:00.000Z'));

    expect(upsert).toHaveBeenCalled();
    expect(
      upsert.mock.calls.every(
        ([input]) => input.create.simulationId === readySimulation.id,
      ),
    ).toBe(true);
  });
});

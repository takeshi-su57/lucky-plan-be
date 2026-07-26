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

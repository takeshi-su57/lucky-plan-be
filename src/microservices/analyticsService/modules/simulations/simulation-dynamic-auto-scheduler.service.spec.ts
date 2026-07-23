import { describe, expect, it, jest } from '@jest/globals';
import { SimulationExecutionPlanStatus } from 'generated/prisma/enums';

import {
  allocateFairPlanSlots,
  calculateEvaluatorQueueRefill,
  SimulationDynamicAutoSchedulerService,
} from './simulation-dynamic-auto-scheduler.service';

describe('allocateFairPlanSlots', () => {
  it('fills twenty slots fairly across nine simulations', () => {
    const allocation = allocateFairPlanSlots(
      Array.from({ length: 9 }, (_, index) => ({
        simulationId: index + 1,
        outstanding: 0,
        availablePlans: 16,
        order: index,
      })),
      20,
    );
    const counts = allocation.reduce<Record<number, number>>((result, id) => {
      result[id] = (result[id] ?? 0) + 1;
      return result;
    }, {});
    expect(allocation).toHaveLength(20);
    expect(Object.values(counts).sort((a, b) => b - a)).toEqual([
      3, 3, 2, 2, 2, 2, 2, 2, 2,
    ]);
  });

  it('accounts for plans that are already outstanding', () => {
    const allocation = allocateFairPlanSlots(
      [
        { simulationId: 1, outstanding: 2, availablePlans: 4, order: 0 },
        { simulationId: 2, outstanding: 0, availablePlans: 4, order: 1 },
      ],
      4,
    );
    expect(allocation).toEqual([2, 2, 1, 2]);
  });
});

describe('calculateEvaluatorQueueRefill', () => {
  it('fills an empty queue to three times fleet capacity', () => {
    expect(calculateEvaluatorQueueRefill(48, 0, 28, 500)).toBe(144);
  });

  it('does not refill while the queue remains at its low watermark', () => {
    expect(calculateEvaluatorQueueRefill(48, 96, 124, 500)).toBe(0);
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
});

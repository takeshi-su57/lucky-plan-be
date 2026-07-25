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

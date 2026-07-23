import { describe, expect, it, jest } from '@jest/globals';
import {
  SimulationEvaluatorTaskStatus,
  SimulationExecutionPlanStatus,
} from 'generated/prisma/enums';

import { SimulationEvaluatorWorkersResolver } from './simulation-evaluator-workers.resolver';

describe('SimulationEvaluatorWorkersResolver pipeline summary', () => {
  it('uses scheduling capacity and reports every downstream stage', async () => {
    const taskCounts: Record<string, number> = {
      [SimulationEvaluatorTaskStatus.Queued]: 2,
      [SimulationEvaluatorTaskStatus.Ready]: 5,
      [SimulationEvaluatorTaskStatus.Claimed]: 10,
    };
    const executionPlanCount = jest.fn((args: any) => {
      const status = args.where.status;
      if (status === SimulationExecutionPlanStatus.Dispatched)
        return Promise.resolve(3);
      if (status === SimulationExecutionPlanStatus.Finalizing)
        return Promise.resolve(2);
      if (status === SimulationExecutionPlanStatus.AwaitingEventLogs)
        return Promise.resolve(4);
      if (status === SimulationExecutionPlanStatus.Failed)
        return Promise.resolve(1);
      return Promise.resolve(20);
    });
    const prisma = {
      simulationEvaluatorWorker: {
        findMany: jest.fn().mockResolvedValue([
          { activeCapacity: 10, desiredCapacity: 4 },
          { activeCapacity: 3, desiredCapacity: 5 },
        ] as never),
      },
      simulationEvaluatorTask: {
        count: jest.fn((args: any) =>
          Promise.resolve(taskCounts[args.where.status] ?? 0),
        ),
      },
      simulationExecutionPlan: { count: executionPlanCount },
    };
    const resolver = new SimulationEvaluatorWorkersResolver(
      prisma as never,
      {} as never,
      {} as never,
      {
        get: jest.fn().mockResolvedValue({
          finalizerConcurrency: 8,
          maxAwaitingFinalizationPlans: 200,
          maxOutstandingDynamicPlans: 500,
        } as never),
      } as never,
    );

    await expect(resolver.simulationEvaluatorPipeline()).resolves.toEqual({
      fleetCapacity: 7,
      queueLowWatermark: 14,
      queueHighWatermark: 21,
      workerClaimLimit: 14,
      queuedEvaluationTasks: 2,
      readyEvaluationTasks: 5,
      claimedEvaluationTasks: 10,
      awaitingFinalizationPlans: 3,
      finalizingPlans: 2,
      awaitingEventLogPlans: 4,
      failedExecutionPlans: 1,
      outstandingExecutionPlans: 20,
      finalizerConcurrency: 8,
      maxAwaitingFinalizationPlans: 200,
      maxOutstandingDynamicPlans: 500,
      backpressureActive: false,
    });
  });
});

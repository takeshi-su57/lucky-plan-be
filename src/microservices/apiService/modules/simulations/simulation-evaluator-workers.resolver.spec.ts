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
          maxAwaitingFinalizationPlans: 6,
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
      maxAwaitingFinalizationPlans: 6,
      maxOutstandingDynamicPlans: 500,
      backpressureActive: false,
    });
  });

  it('rejects an evaluator upgrade that is not newer than the reported version', async () => {
    const prisma = {
      simulationEvaluatorWorker: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'worker-1',
          authorizationStatus: 'Approved',
          version: '3.0.10',
        } as never),
      },
    };
    const tasks = { createTask: jest.fn() };
    const resolver = new SimulationEvaluatorWorkersResolver(
      prisma as never,
      {} as never,
      tasks as never,
      {} as never,
    );

    await expect(
      resolver.upgradeSimulationEvaluatorWorker('worker-1', '3.0.9'),
    ).rejects.toThrow(
      'Version 3.0.9 must be newer than installed version 3.0.10',
    );
    expect(tasks.createTask).not.toHaveBeenCalled();
  });

  it('rejects self-upgrade for an unversioned legacy worker', async () => {
    const prisma = {
      simulationEvaluatorWorker: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'worker-1',
          authorizationStatus: 'Approved',
          version: null,
        } as never),
      },
    };
    const tasks = { createTask: jest.fn() };
    const resolver = new SimulationEvaluatorWorkersResolver(
      prisma as never,
      {} as never,
      tasks as never,
      {} as never,
    );

    await expect(
      resolver.upgradeSimulationEvaluatorWorker('worker-1', '3.0.11'),
    ).rejects.toThrow('install a versioned release manually first');
    expect(tasks.createTask).not.toHaveBeenCalled();
  });

  it('queues an administrator-selected newer evaluator release', async () => {
    const prisma = {
      simulationEvaluatorWorker: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'worker-1',
          authorizationStatus: 'Approved',
          version: '3.0.10',
        } as never),
      },
    };
    const tasks = {
      createTask: jest.fn().mockResolvedValue({ id: 'upgrade-1' } as never),
    };
    const resolver = new SimulationEvaluatorWorkersResolver(
      prisma as never,
      {} as never,
      tasks as never,
      {} as never,
    );

    await expect(
      resolver.upgradeSimulationEvaluatorWorker('worker-1', '3.0.11'),
    ).resolves.toBe('upgrade-1');
    expect(tasks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          version: '3.0.11',
          releaseUrl:
            'https://github.com/takeshi-su57/lucky-plan-be/releases/download/worker-v3.0.11/lucky-evaluator-worker-node22.zip',
        }),
      }),
    );
  });
});

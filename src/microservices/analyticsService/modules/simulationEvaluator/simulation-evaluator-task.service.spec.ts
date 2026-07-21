import { describe, expect, it, jest } from '@jest/globals';
import {
  Platform,
  SimulationEvaluatorWorkerAuthorizationStatus,
  SimulationEvaluatorWorkerDesiredState,
  SimulationEvaluatorWorkerPlatformCacheStatus,
  SimulationEvaluatorWorkerRuntimeStatus,
} from 'generated/prisma/enums';

import { SimulationEvaluatorTaskService } from './simulation-evaluator-task.service';

const EXPECTED_WORKER_HEARTBEAT_TIMEOUT_MS = 60_000;

describe('SimulationEvaluatorTaskService worker freshness', () => {
  it('reuses an in-flight equivalent task after a research retry', async () => {
    const existing = { id: 'task-1' };
    const prisma = {
      simulationEvaluatorDispatcher: {
        findUnique: jest.fn(async () => ({ lastHeartbeatAt: new Date() })),
      },
      simulationEvaluatorTask: {
        findFirst: jest.fn(async () => existing),
        create: jest.fn(),
      },
    };
    const service = new SimulationEvaluatorTaskService(prisma as never);

    const task = await service.createTask({
      kind: 'EvaluateLeaders' as any,
      simulationId: 7,
      rangeStartedAt: new Date('2026-01-01T00:00:00.000Z'),
      rangeEndedAt: new Date('2026-01-06T00:00:00.000Z'),
      input: { candidateLeaders: ['0xabc'] },
    });

    expect(task).toBe(existing);
    expect(prisma.simulationEvaluatorTask.create).not.toHaveBeenCalled();
    expect(
      prisma.simulationEvaluatorTask.findFirst as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: expect.arrayContaining([
              'Queued',
              'Ready',
              'Claimed',
              'Completed',
            ]),
          },
        }),
      }),
    );
  });

  it('does not reuse a cache-prebuild task targeted to another worker', async () => {
    const workerATask = { id: 'task-worker-a' };
    const workerBTask = { id: 'task-worker-b' };
    const prisma = {
      simulationEvaluatorDispatcher: {
        findUnique: jest.fn(async () => ({ lastHeartbeatAt: new Date() })),
      },
      simulationEvaluatorTask: {
        findFirst: jest.fn(async ({ where }) =>
          where.targetWorkerId === 'worker-a' ? workerATask : null,
        ),
        create: jest.fn(async () => workerBTask),
      },
    };
    const service = new SimulationEvaluatorTaskService(prisma as never);
    const rangeStartedAt = new Date('2026-01-01T00:00:00.000Z');
    const rangeEndedAt = new Date('2026-02-01T00:00:00.000Z');
    const input = {
      kind: 'PrebuildPlatformCache' as any,
      rangeStartedAt,
      rangeEndedAt,
      input: { platform: 'GNS' },
    };

    expect(await service.createTask({ ...input, targetWorkerId: 'worker-a' })).toBe(
      workerATask,
    );
    expect(await service.createTask({ ...input, targetWorkerId: 'worker-b' })).toBe(
      workerBTask,
    );
    expect(
      prisma.simulationEvaluatorTask.create as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ targetWorkerId: 'worker-b' }),
      }),
    );
  });

  it('returns the task created by a concurrent scheduler', async () => {
    const concurrentTask = { id: 'task-1' };
    const prisma = {
      simulationEvaluatorDispatcher: {
        findUnique: jest.fn(async () => ({ lastHeartbeatAt: new Date() })),
      },
      simulationEvaluatorTask: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => {
          throw { code: 'P2002' };
        }),
        findUnique: jest.fn(async () => concurrentTask),
      },
    };
    const service = new SimulationEvaluatorTaskService(prisma as never);

    await expect(
      service.createTask({
        kind: 'EvaluateLeaders' as any,
        simulationId: 7,
        rangeStartedAt: new Date('2026-01-01T00:00:00.000Z'),
        rangeEndedAt: new Date('2026-01-06T00:00:00.000Z'),
        input: { candidateLeaders: ['0xabc'] },
      }),
    ).resolves.toBe(concurrentTask);
    expect(
      prisma.simulationEvaluatorTask.findUnique as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ where: { dedupeKey: expect.any(String) } }),
    );
  });

  it('requeues expired claims without waiting for another worker poll', async () => {
    const prisma = {
      simulationEvaluatorTask: {
        findMany: jest.fn(async () => [{ workerId: 'worker-1' }]),
        findFirst: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      simulationEvaluatorWorker: {
        findUnique: jest.fn(async () => null),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const service = new SimulationEvaluatorTaskService(prisma as never);

    await service.reconcileExpiredClaims(new Date('2026-07-19T00:00:00.000Z'));

    expect(
      prisma.simulationEvaluatorTask.updateMany as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'Ready', workerId: null }),
      }),
    );
    expect(
      prisma.simulationEvaluatorWorker.updateMany as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'worker-1' }),
      }),
    );
  });

  it('uses the desired capacity to drain a worker before a scale-down task runs', () => {
    const service = new SimulationEvaluatorTaskService({} as never);

    expect(
      (service as any).getSchedulingCapacity({
        activeCapacity: 10,
        desiredCapacity: 3,
      }),
    ).toBe(3);
  });

  it('counts eligible workers with a recent heartbeat as ready', async () => {
    const prisma = {
      simulationEvaluatorWorker: {
        findMany: jest.fn(async () => []),
      },
      simulationEvaluatorTask: {
        groupBy: jest.fn(async () => []),
      },
    };
    const service = new SimulationEvaluatorTaskService(prisma as never);

    await service.countReadyWorkers(
      Platform.GNS,
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-07-01T00:00:00.000Z'),
    );

    expect(
      prisma.simulationEvaluatorWorker.findMany as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          runtimeStatus: {
            in: [
              SimulationEvaluatorWorkerRuntimeStatus.Free,
              SimulationEvaluatorWorkerRuntimeStatus.Busy,
            ],
          },
          lastHeartbeatAt: {
            gte: expect.any(Date),
          },
        }),
      }),
    );
    const countInput = (
      prisma.simulationEvaluatorWorker.findMany as unknown as jest.Mock
    ).mock.calls[0]![0] as any;
    const cutoff = (countInput.where.lastHeartbeatAt as { gte: Date }).gte;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThanOrEqual(
      EXPECTED_WORKER_HEARTBEAT_TIMEOUT_MS - 1_000,
    );
  });

  it('does not let a stale free worker claim tasks', async () => {
    const prisma = {
      simulationEvaluatorTask: {
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      simulationEvaluatorWorker: {
        findUnique: jest.fn(async () => ({
          id: 'worker-1',
          authorizationStatus:
            SimulationEvaluatorWorkerAuthorizationStatus.Approved,
          desiredState: SimulationEvaluatorWorkerDesiredState.Running,
          runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Free,
          lastHeartbeatAt: new Date(
            Date.now() - EXPECTED_WORKER_HEARTBEAT_TIMEOUT_MS - 1_000,
          ),
          platformCaches: [
            {
              platform: Platform.GNS,
              status: SimulationEvaluatorWorkerPlatformCacheStatus.Ready,
              coveredStartAt: new Date('2026-01-01T00:00:00.000Z'),
              coveredEndAt: new Date('2026-07-01T00:00:00.000Z'),
            },
          ],
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const service = new SimulationEvaluatorTaskService(prisma as never);

    const claimed = await service.claimNextTask('worker-1');

    expect(claimed).toBeNull();
    expect(prisma.simulationEvaluatorTask.findMany).toHaveBeenCalledTimes(1);
    expect(
      prisma.simulationEvaluatorWorker.updateMany as unknown as jest.Mock,
    ).toHaveBeenCalledWith({
      where: {
        id: 'worker-1',
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Free,
      },
      data: {
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Offline,
      },
    });
  });

  it('reconciles stale idle workers from the dispatcher path', async () => {
    const prisma = {
      simulationEvaluatorWorker: {
        updateMany: jest.fn(async () => ({ count: 2 })),
      },
    };
    const service = new SimulationEvaluatorTaskService(prisma as never);

    await (service as any).reconcileStaleIdleWorkers();

    expect(
      prisma.simulationEvaluatorWorker.updateMany as unknown as jest.Mock,
    ).toHaveBeenCalledWith({
      where: {
        runtimeStatus: {
          in: [
            SimulationEvaluatorWorkerRuntimeStatus.Free,
            SimulationEvaluatorWorkerRuntimeStatus.Online,
          ],
        },
        lastHeartbeatAt: {
          lt: expect.any(Date),
        },
      },
      data: { runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Offline },
    });
  });
});

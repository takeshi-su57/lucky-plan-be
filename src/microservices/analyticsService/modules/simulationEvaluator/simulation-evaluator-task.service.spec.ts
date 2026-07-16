import { describe, expect, it, jest } from '@jest/globals';
import {
  Platform,
  SimulationEvaluatorWorkerAuthorizationStatus,
  SimulationEvaluatorWorkerPlatformCacheStatus,
  SimulationEvaluatorWorkerRuntimeStatus,
} from 'generated/prisma/enums';

import { SimulationEvaluatorTaskService } from './simulation-evaluator-task.service';

const EXPECTED_WORKER_HEARTBEAT_TIMEOUT_MS = 60_000;

describe('SimulationEvaluatorTaskService worker freshness', () => {
  it('counts only free workers with a recent heartbeat as ready', async () => {
    const prisma = {
      simulationEvaluatorWorker: {
        findMany: jest.fn(async () => []),
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
          runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Free,
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

import { describe, expect, it, jest } from '@jest/globals';
import {
  SimulationEvaluatorTaskStatus,
  SimulationEvaluatorWorkerRuntimeStatus,
} from 'generated/prisma/enums';

import { SimulationEvaluatorWorkerAuthService } from './simulation-evaluator-worker-auth.service';

describe('SimulationEvaluatorWorkerAuthService', () => {
  it('deletes an offline worker with its tasks and cache coverage', async () => {
    const transaction = jest.fn(async () => []);
    const prisma = {
      simulationEvaluatorWorker: {
        findUnique: jest.fn(async () => ({ runtimeStatus: 'Offline' })),
        delete: jest.fn(() => ({ operation: 'worker-delete' })),
      },
      simulationEvaluatorTask: {
        findFirst: jest.fn(async () => null),
        deleteMany: jest.fn(() => ({ operation: 'task-delete' })),
      },
      simulationEvaluatorWorkerPlatformCache: {
        deleteMany: jest.fn(() => ({ operation: 'cache-delete' })),
      },
      $transaction: transaction,
    };
    const service = new SimulationEvaluatorWorkerAuthService(prisma as never);

    await expect(service.removeOfflineWorker('worker-1')).resolves.toBe(true);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      prisma.simulationEvaluatorTask.deleteMany as jest.Mock,
    ).toHaveBeenCalledWith({
      where: {
        OR: [{ workerId: 'worker-1' }, { targetWorkerId: 'worker-1' }],
      },
    });
    expect(
      prisma.simulationEvaluatorWorkerPlatformCache.deleteMany as jest.Mock,
    ).toHaveBeenCalledWith({ where: { workerId: 'worker-1' } });
  });

  it('clears a stale prebuilding status when the reconnecting worker has no active task', async () => {
    const prisma = {
      simulationEvaluatorTask: {
        findFirst: jest.fn(async () => null),
      },
      simulationEvaluatorWorker: {
        update: jest.fn(async () => ({})),
      },
    };
    const service = new SimulationEvaluatorWorkerAuthService(prisma as never);

    await service.recordPresence('worker-1');

    const activeTaskQuery = (
      prisma.simulationEvaluatorTask.findFirst as jest.Mock
    ).mock.calls[0]![0] as any;
    expect(activeTaskQuery.where.workerId).toBe('worker-1');
    expect(activeTaskQuery.where.status).toBe(
      SimulationEvaluatorTaskStatus.Claimed,
    );
    const workerUpdate = (prisma.simulationEvaluatorWorker.update as jest.Mock)
      .mock.calls[0]![0] as any;
    expect(workerUpdate.where).toEqual({ id: 'worker-1' });
    expect(workerUpdate.data.runtimeStatus).toBe(
      SimulationEvaluatorWorkerRuntimeStatus.Free,
    );
  });
});

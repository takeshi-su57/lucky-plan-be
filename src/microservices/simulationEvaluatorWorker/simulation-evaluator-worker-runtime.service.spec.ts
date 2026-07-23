import { describe, expect, it, jest } from '@jest/globals';
import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';

import { SimulationEvaluatorWorkerRuntimeService } from './simulation-evaluator-worker-runtime.service';

describe('SimulationEvaluatorWorkerRuntimeService', () => {
  it('rehydrates the desired child capacity before polling after a restart', async () => {
    const client = {
      joinHeartbeat: jest.fn(async () => ({
        authorizationStatus: 'Approved',
        desiredCapacity: 5,
      })),
      poll: jest.fn(async () => {
        (runtime as any).stopping = true;
        return { task: null };
      }),
    };
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      client as never,
      {} as never,
    );
    const ensureCapacity = jest
      .spyOn(runtime as any, 'ensureCapacity')
      .mockResolvedValue(undefined);

    await (runtime as any).run();

    expect(ensureCapacity).toHaveBeenCalledWith(5);
    expect(client.poll).toHaveBeenCalledTimes(1);
  });

  it('keeps an approved worker eligible to renew its task lease after a transient heartbeat failure', async () => {
    const client = {
      heartbeat: jest.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    };
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      client as never,
      {} as never,
    );
    (runtime as any).approved = true;
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await (runtime as any).sendHeartbeat();

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect((runtime as any).approved).toBe(true);
    expect((runtime as any).heartbeatInFlight).toBe(false);
    consoleError.mockRestore();
  });

  it('heartbeats prefetched work while keeping it behind active child capacity', () => {
    const client = {
      beginTask: jest.fn(),
    };
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      client as never,
      {} as never,
    );
    (runtime as any).idleChildren.add({});
    const processTask = jest
      .spyOn(runtime as any, 'processTask')
      .mockImplementation(() => new Promise(() => undefined));
    const first = {
      id: 'task-1',
      kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
      leaseToken: 'lease-1',
    };
    const prefetched = {
      id: 'task-2',
      kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
      leaseToken: 'lease-2',
    };

    (runtime as any).acceptTask(first);
    (runtime as any).acceptTask(prefetched);

    expect(client.beginTask).toHaveBeenCalledTimes(2);
    expect(processTask).toHaveBeenCalledTimes(1);
    expect((runtime as any).pendingEvaluations).toEqual([prefetched]);
  });

  it('waits for a replacement when a reserved child exits during input loading', async () => {
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      {} as never,
      {} as never,
    );
    const deadChild = { exitCode: 1, connected: false };
    const replacement = { exitCode: null, connected: true };
    (runtime as any).startingEvaluations.set('task-1', deadChild);

    const acquired = (runtime as any).acquireEvaluationChild('task-1');
    (runtime as any).children.add(replacement);
    (runtime as any).offerIdleChild(replacement);

    await expect(acquired).resolves.toBe(replacement);
  });
});

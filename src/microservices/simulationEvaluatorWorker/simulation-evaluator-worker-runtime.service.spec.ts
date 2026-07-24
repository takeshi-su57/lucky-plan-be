import { describe, expect, it, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';

import {
  evaluatorWorkerRestartExitCode,
  SimulationEvaluatorWorkerRuntimeService,
} from './simulation-evaluator-worker-runtime.service';

describe('SimulationEvaluatorWorkerRuntimeService', () => {
  it('uses a failure exit on Windows so Task Scheduler restarts the worker', () => {
    expect(evaluatorWorkerRestartExitCode('win32')).toBe(1);
    expect(evaluatorWorkerRestartExitCode('linux')).toBe(0);
  });

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

  it('runs a received capacity command before prefetched evaluations', () => {
    const client = {
      beginTask: jest.fn(),
      fail: jest.fn(),
      endTask: jest.fn(),
    };
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      client as never,
      {} as never,
    );
    const runningChild = {};
    const prefetched = {
      id: 'evaluation-prefetched',
      kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
      leaseToken: 'evaluation-lease',
    };
    const capacity = {
      id: 'capacity-1',
      kind: SimulationEvaluatorTaskKind.SetWorkerCapacity,
      leaseToken: 'capacity-lease',
    };
    (runtime as any).startingEvaluations.set(
      'evaluation-running',
      runningChild,
    );
    (runtime as any).pendingEvaluations.push(prefetched);
    const processTask = jest
      .spyOn(runtime as any, 'processTask')
      .mockImplementation(() => new Promise(() => undefined));

    (runtime as any).acceptTask(capacity);

    expect(processTask).not.toHaveBeenCalled();
    expect((runtime as any).pendingEvaluations).toEqual([prefetched]);

    (runtime as any).startingEvaluations.delete('evaluation-running');
    (runtime as any).drainWork();

    expect(processTask).toHaveBeenCalledWith(capacity);
    expect((runtime as any).pendingEvaluations).toEqual([prefetched]);
  });

  it('waits for evaluations already running in children before a capacity command', () => {
    const client = {
      beginTask: jest.fn(),
      fail: jest.fn(),
      endTask: jest.fn(),
    };
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      client as never,
      {} as never,
    );
    const capacity = {
      id: 'capacity-1',
      kind: SimulationEvaluatorTaskKind.SetWorkerCapacity,
      leaseToken: 'capacity-lease',
    };
    const processTask = jest
      .spyOn(runtime as any, 'processTask')
      .mockImplementation(() => new Promise(() => undefined));
    (runtime as any).activeEvaluationTaskIds.add('evaluation-running');

    (runtime as any).acceptTask(capacity);

    expect(processTask).not.toHaveBeenCalled();

    (runtime as any).activeEvaluationTaskIds.delete('evaluation-running');
    (runtime as any).drainWork();

    expect(processTask).toHaveBeenCalledWith(capacity);
  });

  it('releases prefetched evaluations while the worker is draining', async () => {
    const client = {
      release: jest.fn(async () => undefined),
      endTask: jest.fn(),
    };
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      client as never,
      {} as never,
    );
    (runtime as any).pendingEvaluations.push(
      {
        id: 'task-1',
        kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
        leaseToken: 'lease-1',
      },
      {
        id: 'task-2',
        kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
        leaseToken: 'lease-2',
      },
    );
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await (runtime as any).releasePendingEvaluations();

    expect(client.release).toHaveBeenCalledTimes(2);
    expect(client.endTask).toHaveBeenCalledTimes(2);
    expect((runtime as any).pendingEvaluations).toEqual([]);
    jest.restoreAllMocks();
  });

  it('retires a child that finishes after capacity was reduced', () => {
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      {} as never,
      {} as never,
    );
    const completedChild = {};
    const otherChild = {};
    (runtime as any).children.add(completedChild);
    (runtime as any).children.add(otherChild);
    (runtime as any).desiredChildCapacity = 1;
    const retireChild = jest
      .spyOn(runtime as any, 'retireChild')
      .mockResolvedValue(undefined);

    (runtime as any).releaseEvaluationChild(completedChild);

    expect(retireChild).toHaveBeenCalledWith(completedChild);
    expect((runtime as any).idleChildren.has(completedChild)).toBe(false);
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

  it('keeps an upgrade lease active and flushes progress before restart', async () => {
    jest.useFakeTimers();
    const client = {
      getInput: jest.fn(async () => ({
        input: { version: '3.0.2', releaseUrl: 'https://example.invalid' },
      })),
      heartbeat: jest.fn(async () => undefined),
      complete: jest.fn(
        async (
          _taskId: string,
          _leaseToken: string,
          _result: Record<string, unknown>,
        ) => undefined,
      ),
      fail: jest.fn(async () => undefined),
      endTask: jest.fn(),
    };
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      client as never,
      {} as never,
    );
    jest.spyOn(runtime as any, 'prepareSelfUpgrade').mockImplementation(() => {
      (runtime as any).upgradeScheduled = true;
      return Promise.resolve();
    });
    const exit = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);

    await (runtime as any).processTask({
      id: 'upgrade-1',
      kind: SimulationEvaluatorTaskKind.UpgradeWorker,
      leaseToken: 'lease-1',
    });

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.endTask).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(exit).toHaveBeenCalledWith(
      evaluatorWorkerRestartExitCode(process.platform),
    );
    exit.mockRestore();
    jest.useRealTimers();
  });

  it('finalizes a persisted upgrade result and releases its lease', async () => {
    const readFile = jest.spyOn(fs, 'readFile').mockResolvedValue(
      JSON.stringify({
        taskId: 'upgrade-1',
        leaseToken: 'lease-1',
        version: '0.0.1',
        status: 'applied',
      }),
    );
    const unlink = jest.spyOn(fs, 'unlink').mockResolvedValue();
    const client = {
      beginTask: jest.fn(),
      reportTaskProgress: jest.fn(),
      complete: jest.fn(
        async (
          _taskId: string,
          _leaseToken: string,
          _result: Record<string, unknown>,
        ) => undefined,
      ),
      fail: jest.fn(async () => undefined),
      endTask: jest.fn(),
    };
    const runtime = new SimulationEvaluatorWorkerRuntimeService(
      client as never,
      {} as never,
    );

    await (runtime as any).finalizePendingUpgradeWithRetry();

    expect(client.beginTask).toHaveBeenCalledWith('upgrade-1', 'lease-1');
    expect(client.complete).toHaveBeenCalledWith('upgrade-1', 'lease-1', {
      status: 'completed',
      version: '0.0.1',
    });
    expect(client.endTask).toHaveBeenCalledWith('upgrade-1');
    expect(unlink).toHaveBeenCalled();
    readFile.mockRestore();
    unlink.mockRestore();
  });
});

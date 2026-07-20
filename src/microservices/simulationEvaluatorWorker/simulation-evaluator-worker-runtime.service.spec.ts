import { describe, expect, it, jest } from '@jest/globals';

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
});

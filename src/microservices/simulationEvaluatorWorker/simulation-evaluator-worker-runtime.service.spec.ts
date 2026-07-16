import { describe, expect, it, jest } from '@jest/globals';

import { SimulationEvaluatorWorkerRuntimeService } from './simulation-evaluator-worker-runtime.service';

describe('SimulationEvaluatorWorkerRuntimeService', () => {
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

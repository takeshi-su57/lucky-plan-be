import { describe, expect, it, jest } from '@jest/globals';

import { SimulationAutomationCronService } from './simulation-automation-cron.service';

describe('SimulationAutomationCronService', () => {
  it('does not process another simulation while a tick is active', async () => {
    let resolveRun: (() => void) | undefined;
    const processNextQueuedAutoSimulation = jest.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveRun = () => resolve(null);
        }),
    );
    const service = new SimulationAutomationCronService(
      { processNextQueuedAutoSimulation } as never,
      { nativeLog: jest.fn() } as never,
    );

    const firstTick = service.processQueuedSimulation();
    await Promise.resolve();
    await service.processQueuedSimulation();
    resolveRun?.();
    await firstTick;

    expect(processNextQueuedAutoSimulation).toHaveBeenCalledTimes(1);
  });
});

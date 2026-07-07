import { describe, expect, it, jest } from '@jest/globals';

import { SimulationResearchAutomationCronService } from './simulation-research-automation-cron.service';

describe('SimulationResearchAutomationCronService', () => {
  it('does not process another research while a tick is active', async () => {
    let resolveRun: (() => void) | undefined;
    const processNextQueuedResearch = jest.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveRun = () => resolve(null);
        }),
    );
    const service = new SimulationResearchAutomationCronService(
      { processNextQueuedResearch } as never,
      { nativeLog: jest.fn() } as never,
    );

    const firstTick = service.processQueuedResearch();
    await Promise.resolve();
    await service.processQueuedResearch();
    resolveRun?.();
    await firstTick;

    expect(processNextQueuedResearch).toHaveBeenCalledTimes(1);
  });
});

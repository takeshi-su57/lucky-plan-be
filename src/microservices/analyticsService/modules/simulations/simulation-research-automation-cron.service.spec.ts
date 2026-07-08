import { describe, expect, it, jest } from '@jest/globals';

import { SimulationResearchAutomationCronService } from './simulation-research-automation-cron.service';

describe('SimulationResearchAutomationCronService', () => {
  it('does not process another research while a tick is active', async () => {
    let resolveRun: (() => void) | undefined;
    const processNextAutomaticResearch = jest.fn(
      () =>
        new Promise<null>((resolve) => {
          resolveRun = () => resolve(null);
        }),
    );
    const service = new SimulationResearchAutomationCronService(
      { processNextAutomaticResearch } as never,
      { nativeLog: jest.fn() } as never,
    );

    const firstTick = service.processAutomaticResearch();
    await Promise.resolve();
    await service.processAutomaticResearch();
    resolveRun?.();
    await firstTick;

    expect(processNextAutomaticResearch).toHaveBeenCalledTimes(1);
  });
});

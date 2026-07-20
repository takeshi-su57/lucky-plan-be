import { describe, expect, it, jest } from '@jest/globals';
import { SimulationStatus } from 'generated/prisma/enums';

import { SimulationResearchDynamicAutoRunnerService } from './simulation-research-dynamic-auto-runner.service';

describe('SimulationResearchDynamicAutoRunnerService', () => {
  it('returns interrupted worker-driven research to a claimable state', async () => {
    let findCalls = 0;
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => {
          if (findCalls++ === 0)
            throw new Error('Simulation evaluator task task-1 timed out');
          return { simulations: [] };
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const service = new SimulationResearchDynamicAutoRunnerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      { nativeLog: jest.fn() } as never,
    );

    await service.playAutomaticResearch(1);

    expect(
      prisma.simulationResearch.updateMany as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SimulationStatus.Paused,
          progressPhase: 'dynamic-retry-pending',
          finishedAt: null,
          retryAttempts: 1,
          nextRetryAt: expect.any(Date),
        }),
      }),
    );
  });

  it('fails and logs non-transient dynamic-runner errors immediately', async () => {
    const logger = { nativeLog: jest.fn(async () => undefined) };
    let findCalls = 0;
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => {
          if (findCalls++ === 0)
            throw new Error('Evaluator task task-1 returned an invalid result');
          return { simulations: [] };
        }),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const service = new SimulationResearchDynamicAutoRunnerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      logger as never,
    );

    await service.playAutomaticResearch(1);

    expect(
      prisma.simulationResearch.updateMany as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SimulationStatus.Failed,
          progressPhase: 'dynamic-failed',
          nextRetryAt: null,
          finishedAt: expect.any(Date),
        }),
      }),
    );
    expect(logger.nativeLog as unknown as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'Error' }),
    );
  });
});

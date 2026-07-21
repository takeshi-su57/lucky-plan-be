import { describe, expect, it, jest } from '@jest/globals';

import { SimulationResearchExecutionFlow } from 'generated/prisma/enums';

import { AnalyticsSimulationResearchService } from './analytics-simulation-research.service';

describe('AnalyticsSimulationResearchService', () => {
  it('runs centralized research through the legacy auto runner', async () => {
    const prisma = {
      simulationResearch: {
        findFirst: jest.fn(async () => ({
          executionFlow: SimulationResearchExecutionFlow.Centralized,
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const legacyRunner = { playAutomaticResearch: jest.fn() };
    const dynamicRunner = { playAutomaticResearch: jest.fn() };
    const service = new AnalyticsSimulationResearchService(
      prisma as never,
      legacyRunner as never,
      dynamicRunner as never,
    );

    await service['runResearch'](42, 'lease-42');

    expect(legacyRunner.playAutomaticResearch).toHaveBeenCalledWith(
      42,
      undefined,
      'lease-42',
    );
    expect(dynamicRunner.playAutomaticResearch).not.toHaveBeenCalled();
  });

  it('runs dynamic research only through the worker-driven runner', async () => {
    const prisma = {
      simulationResearch: {
        findFirst: jest.fn(async () => ({
          executionFlow: SimulationResearchExecutionFlow.DynamicExperimental,
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    };
    const legacyRunner = { playAutomaticResearch: jest.fn() };
    const dynamicRunner = { playAutomaticResearch: jest.fn() };
    const service = new AnalyticsSimulationResearchService(
      prisma as never,
      legacyRunner as never,
      dynamicRunner as never,
    );

    await service['runResearch'](99, 'lease-99');

    expect(dynamicRunner.playAutomaticResearch).toHaveBeenCalledWith(
      99,
      undefined,
      'lease-99',
    );
    expect(legacyRunner.playAutomaticResearch).not.toHaveBeenCalled();
  });

  it('does not claim manually paused research', async () => {
    const prisma = {
      simulationResearch: {
        findFirst: jest.fn(async () => null),
      },
    };
    const service = new AnalyticsSimulationResearchService(
      prisma as never,
      {} as never,
      {} as never,
    );

    await service.processNextAutomaticResearch(new Date('2026-07-20'));

    expect(
      prisma.simulationResearch.findFirst as unknown as jest.Mock,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ automationEnabled: true }),
      }),
    );
  });
});

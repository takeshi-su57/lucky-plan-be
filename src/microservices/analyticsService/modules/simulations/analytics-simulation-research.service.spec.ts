import { describe, expect, it, jest } from '@jest/globals';

import { SimulationResearchExecutionFlow } from 'generated/prisma/enums';

import { AnalyticsSimulationResearchService } from './analytics-simulation-research.service';

describe('AnalyticsSimulationResearchService', () => {
  it('runs centralized research through the legacy auto runner', async () => {
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => ({
          executionFlow: SimulationResearchExecutionFlow.Centralized,
        })),
      },
    };
    const legacyRunner = { playAutomaticResearch: jest.fn() };
    const dynamicRunner = { playAutomaticResearch: jest.fn() };
    const service = new AnalyticsSimulationResearchService(
      prisma as never,
      legacyRunner as never,
      dynamicRunner as never,
    );

    await service['runResearch'](42);

    expect(legacyRunner.playAutomaticResearch).toHaveBeenCalledWith(42);
    expect(dynamicRunner.playAutomaticResearch).not.toHaveBeenCalled();
  });

  it('runs dynamic research only through the worker-driven runner', async () => {
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => ({
          executionFlow: SimulationResearchExecutionFlow.DynamicExperimental,
        })),
      },
    };
    const legacyRunner = { playAutomaticResearch: jest.fn() };
    const dynamicRunner = { playAutomaticResearch: jest.fn() };
    const service = new AnalyticsSimulationResearchService(
      prisma as never,
      legacyRunner as never,
      dynamicRunner as never,
    );

    await service['runResearch'](99);

    expect(dynamicRunner.playAutomaticResearch).toHaveBeenCalledWith(99);
    expect(legacyRunner.playAutomaticResearch).not.toHaveBeenCalled();
  });
});

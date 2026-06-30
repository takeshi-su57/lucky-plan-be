import { describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';

import { SimulationsService } from './simulations.service';

describe('SimulationsService API queue requests', () => {
  it('marks a simulation as queued without running analytics execution', async () => {
    const simulation = {
      id: 1,
      title: 'Research simulation',
      description: 'Queued from API',
      platform: Platform.GNS,
      researchId: null,
      direction: BotMode.Reversed,
      startAt: new Date('2026-05-01T00:00:00.000Z'),
      endAt: new Date('2026-06-01T00:00:00.000Z'),
      cursor: null,
      status: SimulationStatus.Created,
      progressPhase: 'created',
      progressMessage: 'Simulation created',
      progressPercent: 0,
      selectedLeaderCount: 10,
      trade: { min: 3, max: 100 },
      r2: { min: 0.5, max: 1 },
      slope: { min: 0, max: 100 },
      standardCollateralUsd: 100,
      maxLeverage: 50,
      totalSimulationPlans: 31,
      completedPlans: 0,
      totalLeaderPnl: 0,
      totalFollowerPnl: 0,
      totalNetPnlUsd: 0,
      totalCostUsd: 0,
      maxDrawdownUsd: 0,
      tradeCount: 0,
      winRate: 0,
      profitFactor: 0,
      error: null,
      createdAt: new Date('2026-04-01T00:00:00.000Z'),
      updatedAt: new Date('2026-04-01T00:00:00.000Z'),
    };
    const updated = {
      ...simulation,
      status: SimulationStatus.Paused,
      progressPhase: 'queued',
      progressMessage: 'Simulation queued for analytics automation',
    };
    const prisma = {
      simulation: {
        findUnique: jest.fn(async () => simulation),
        update: jest.fn(async () => updated),
      },
    };
    const service = new SimulationsService(prisma as never, {} as never);

    const result = await service.playAutoSimulation(1);

    expect((prisma.simulation.update as any).mock.calls[0][0]).toEqual({
      where: { id: 1 },
      data: {
        status: SimulationStatus.Paused,
        error: null,
        progressPhase: 'queued',
        progressMessage: 'Simulation queued for analytics automation',
      },
    });
    expect(result.status).toBe(SimulationStatus.Paused);
  });
});

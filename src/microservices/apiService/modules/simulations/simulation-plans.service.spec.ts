import { describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform, SimulationStatus } from 'generated/prisma/enums';

import { SimulationPlansService } from './simulation-plans.service';

describe('SimulationPlansService delete operations', () => {
  it('deletes a simulation bot so its cache can cascade away', async () => {
    const tx = {
      simulationBot: {
        findUnique: jest.fn(async () => ({
          id: 31,
          simulationPlanId: 22,
          leaderAddress: '0xabc',
          leaderPlatform: Platform.GNS,
          startedAt: new Date('2026-07-01T00:00:00.000Z'),
          stoppedAt: null,
          mode: BotMode.Reversed,
          ratio: 1,
          simulationPlan: {
            id: 22,
            simulationId: null,
            simulation: null,
          },
        })),
        delete: jest.fn(async () => ({ id: 31 })),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const service = new SimulationPlansService(prisma as never, {} as never);

    const result = await service.deleteSimulationBot(31);

    expect(result).toBe(31);
    expect(tx.simulationBot.findUnique as any).toHaveBeenCalledWith({
      where: { id: 31 },
      include: {
        simulationPlan: {
          include: {
            simulation: true,
          },
        },
      },
    });
    expect(tx.simulationBot.delete as any).toHaveBeenCalledWith({
      where: { id: 31 },
    });
  });

  it('rejects deleting a simulation bot from a running simulation', async () => {
    const tx = {
      simulationBot: {
        findUnique: jest.fn(async () => ({
          id: 31,
          simulationPlan: {
            id: 22,
            simulationId: 9,
            simulation: { id: 9, status: SimulationStatus.Running },
          },
        })),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: any) => callback(tx)),
    };
    const service = new SimulationPlansService(prisma as never, {} as never);

    await expect(service.deleteSimulationBot(31)).rejects.toThrow(
      'Cannot delete a bot from a running simulation',
    );
  });
});

import { describe, expect, it, jest } from '@jest/globals';

import { SimulationResearchAutoRunnerService } from './simulation-research-auto-runner.service';

describe('SimulationResearchAutoRunnerService', () => {
  it('loads a claimed research without processing ranges yet', async () => {
    const research = { id: 31, simulations: [{ status: 'Created' }] };
    const prisma = {
      simulationResearch: {
        findUnique: jest.fn(async () => research),
      },
    };
    const service = new SimulationResearchAutoRunnerService(prisma as never);

    const result = await service.playQueuedResearch(31);

    expect(prisma.simulationResearch.findUnique as any).toHaveBeenCalledWith({
      where: { id: 31 },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });
    expect(result).toBe(research);
  });
});

import { Injectable } from '@nestjs/common';
import { SimulationStatus } from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationResearchAutoRunnerService } from './simulation-research-auto-runner.service';

@Injectable()
export class AnalyticsSimulationResearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationResearchAutoRunnerService: SimulationResearchAutoRunnerService,
  ) {}

  async processNextQueuedResearch(now = new Date()): Promise<void> {
    const research = await this.prisma.simulationResearch.findFirst({
      where: { status: SimulationStatus.Queued },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    if (!research) {
      return;
    }

    const claim = await this.prisma.simulationResearch.updateMany({
      where: { id: research.id, status: SimulationStatus.Queued },
      data: {
        status: SimulationStatus.Running,
        startedAt: now,
        finishedAt: null,
        lastError: null,
        progressPhase: 'running',
        progressMessage: 'Research automation started',
      },
    });

    if (claim.count === 0) {
      return;
    }

    this.simulationResearchAutoRunnerService.playQueuedResearch(research.id);
  }
}

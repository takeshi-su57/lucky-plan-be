import { Injectable } from '@nestjs/common';
import { SimulationStatus } from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationResearchAutoRunnerService } from './simulation-research-auto-runner.service';

const AUTOMATIC_RESEARCH_STATUSES = [
  SimulationStatus.Created,
  SimulationStatus.Paused,
  SimulationStatus.Queued,
];

@Injectable()
export class AnalyticsSimulationResearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationResearchAutoRunnerService: SimulationResearchAutoRunnerService,
  ) {}

  async processNextAutomaticResearch(now = new Date()) {
    const research = await this.prisma.simulationResearch.findFirst({
      where: { status: { in: AUTOMATIC_RESEARCH_STATUSES } },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    if (!research) {
      return;
    }

    const claim = await this.prisma.simulationResearch.updateMany({
      where: { id: research.id, status: { in: AUTOMATIC_RESEARCH_STATUSES } },
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

    this.simulationResearchAutoRunnerService.playAutomaticResearch(research.id);
  }
}

import { Injectable } from '@nestjs/common';
import {
  SimulationResearchExecutionFlow,
  SimulationStatus,
} from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationResearchAutoRunnerService } from './simulation-research-auto-runner.service';
import { SimulationResearchDynamicAutoRunnerService } from './simulation-research-dynamic-auto-runner.service';

const AUTOMATIC_RESEARCH_STATUSES = [
  SimulationStatus.Created,
  SimulationStatus.Paused,
  SimulationStatus.Queued,
];

@Injectable()
export class AnalyticsSimulationResearchService {
  private activeResearchId: number | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationResearchAutoRunnerService: SimulationResearchAutoRunnerService,
    private readonly simulationResearchDynamicAutoRunnerService: SimulationResearchDynamicAutoRunnerService,
  ) {}

  async processNextAutomaticResearch(now = new Date()) {
    if (this.activeResearchId !== null) {
      return null;
    }

    const runningResearch = await this.prisma.simulationResearch.findFirst({
      where: { status: SimulationStatus.Running },
    });

    if (runningResearch) {
      return await this.runResearch(runningResearch.id);
    }

    const research = await this.prisma.simulationResearch.findFirst({
      where: { status: { in: AUTOMATIC_RESEARCH_STATUSES } },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    if (!research) {
      return null;
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
      return null;
    }

    return await this.runResearch(research.id);
  }

  private async runResearch(id: number) {
    if (this.activeResearchId !== null) {
      return null;
    }

    this.activeResearchId = id;

    try {
      const research = await this.prisma.simulationResearch.findUnique({
        where: { id },
        select: { executionFlow: true },
      });
      if (
        research?.executionFlow ===
        SimulationResearchExecutionFlow.DynamicExperimental
      ) {
        return await this.simulationResearchDynamicAutoRunnerService.playAutomaticResearch(
          id,
        );
      }
      return await this.simulationResearchAutoRunnerService.playAutomaticResearch(
        id,
      );
    } finally {
      this.activeResearchId = null;
    }
  }
}

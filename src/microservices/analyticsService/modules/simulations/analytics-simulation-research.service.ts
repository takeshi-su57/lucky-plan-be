import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
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
const AUTOMATION_LEASE_DURATION_MS = 2 * 60_000;
const AUTOMATION_LEASE_RENEWAL_MS = 30_000;

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

    const research = await this.prisma.simulationResearch.findFirst({
      where: {
        automationEnabled: true,
        OR: [
          {
            status: SimulationStatus.Running,
            OR: [
              { automationLeaseExpiresAt: null },
              { automationLeaseExpiresAt: { lte: now } },
            ],
          },
          {
            status: { in: AUTOMATIC_RESEARCH_STATUSES },
            OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
          },
        ],
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });

    if (!research) {
      return null;
    }

    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(
      now.getTime() + AUTOMATION_LEASE_DURATION_MS,
    );
    const isRunning = research.status === SimulationStatus.Running;
    const claim = await this.prisma.simulationResearch.updateMany({
      where: isRunning
        ? {
            id: research.id,
            status: SimulationStatus.Running,
            automationEnabled: true,
            OR: [
              { automationLeaseExpiresAt: null },
              { automationLeaseExpiresAt: { lte: now } },
            ],
          }
        : {
            id: research.id,
            status: { in: AUTOMATIC_RESEARCH_STATUSES },
            automationEnabled: true,
          },
      data: {
        ...(isRunning
          ? {}
          : {
              status: SimulationStatus.Running,
              startedAt: now,
              finishedAt: null,
              lastError: null,
              nextRetryAt: null,
              progressPhase: 'running',
              progressMessage: 'Research automation started',
            }),
        automationLeaseToken: leaseToken,
        automationLeaseExpiresAt: leaseExpiresAt,
      },
    });

    if (claim.count === 0) {
      return null;
    }

    return await this.runResearch(research.id, leaseToken);
  }

  private async runResearch(id: number, leaseToken: string) {
    if (this.activeResearchId !== null) {
      return null;
    }

    this.activeResearchId = id;
    const leaseTimer = setInterval(() => {
      void this.renewLease(id, leaseToken);
    }, AUTOMATION_LEASE_RENEWAL_MS);

    try {
      const research = await this.prisma.simulationResearch.findFirst({
        where: { id, automationLeaseToken: leaseToken },
        select: { executionFlow: true },
      });
      if (
        research?.executionFlow ===
        SimulationResearchExecutionFlow.DynamicExperimental
      ) {
        return await this.simulationResearchDynamicAutoRunnerService.playAutomaticResearch(
          id,
          undefined,
          leaseToken,
        );
      }
      return await this.simulationResearchAutoRunnerService.playAutomaticResearch(
        id,
        undefined,
        leaseToken,
      );
    } finally {
      clearInterval(leaseTimer);
      await this.prisma.simulationResearch.updateMany({
        where: { id, automationLeaseToken: leaseToken },
        data: {
          automationLeaseToken: null,
          automationLeaseExpiresAt: null,
        },
      });
      this.activeResearchId = null;
    }
  }

  private async renewLease(id: number, leaseToken: string) {
    await this.prisma.simulationResearch.updateMany({
      where: {
        id,
        status: SimulationStatus.Running,
        automationEnabled: true,
        automationLeaseToken: leaseToken,
      },
      data: {
        automationLeaseExpiresAt: new Date(
          Date.now() + AUTOMATION_LEASE_DURATION_MS,
        ),
      },
    });
  }
}

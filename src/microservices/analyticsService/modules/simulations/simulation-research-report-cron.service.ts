import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { SimulationStatus } from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationResearchReportService } from './research-report/simulation-research-report.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';

const LOCK_ID = 'global';
const LOCK_TTL_MS = 60 * 60 * 1000;
const MAX_RETRY_DELAY_MS = 30 * 60 * 1000;

function retryAt(attempts: number) {
  const delay = Math.min(
    30_000 * 2 ** Math.min(attempts, 10),
    MAX_RETRY_DELAY_MS,
  );
  return new Date(Date.now() + delay);
}

/** Runs only in analytics and permits one report build across all instances. */
@Injectable()
export class SimulationResearchReportCronService {
  private readonly logger = new Logger(
    SimulationResearchReportCronService.name,
  );
  private readonly owner = randomUUID();
  private running = false;
  private lockHeartbeat?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: SimulationResearchReportService,
    private readonly runner: SimulationAutoRunnerService,
  ) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async generateNextReport() {
    if (this.running || !(await this.acquireLock())) return;
    this.running = true;
    this.lockHeartbeat = setInterval(() => void this.extendLock(), 30_000);
    try {
      const research = await this.prisma.simulationResearch.findFirst({
        where: {
          status: SimulationStatus.Completed,
          aiReportReady: false,
          OR: [
            { aiReportRetryAt: null },
            { aiReportRetryAt: { lte: new Date() } },
          ],
        },
        orderBy: [{ finishedAt: 'asc' }, { id: 'asc' }],
        select: { id: true, aiReportRevision: true, aiReportAttempts: true },
      });
      if (!research) return;

      // A completed research can be edited or restarted after it has been
      // selected. Only claim the exact revision selected above; an older job
      // must never overwrite the state of the replacement report.
      const claimed = await this.prisma.simulationResearch.updateMany({
        where: {
          id: research.id,
          aiReportRevision: research.aiReportRevision,
          status: SimulationStatus.Completed,
          aiReportReady: false,
        },
        data: {
          aiReportGenerating: true,
          aiReportError: null,
          aiReportRetryAt: null,
        },
      });
      if (claimed.count === 0) return;
      await this.runner.emitSimulationResearchUpdated(research.id);
      try {
        await this.reports.getOrBuildAiStandardZip(
          research.id,
          research.aiReportRevision,
        );
        const published = await this.prisma.simulationResearch.updateMany({
          where: {
            id: research.id,
            aiReportRevision: research.aiReportRevision,
          },
          data: {
            aiReportReady: true,
            aiReportGenerating: false,
            aiReportError: null,
            aiReportAttempts: 0,
            aiReportRetryAt: null,
          },
        });
        if (published.count === 0) {
          this.logger.warn(
            `Discarded stale AI report for research ${research.id}`,
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `AI report generation failed for research ${research.id}`,
          error instanceof Error ? error.stack : message,
        );
        await this.prisma.simulationResearch.updateMany({
          where: {
            id: research.id,
            aiReportRevision: research.aiReportRevision,
          },
          data: {
            aiReportGenerating: false,
            aiReportError: message,
            aiReportAttempts: { increment: 1 },
            aiReportRetryAt: retryAt(research.aiReportAttempts + 1),
          },
        });
      }
      await this.runner.emitSimulationResearchUpdated(research.id);
    } finally {
      if (this.lockHeartbeat) clearInterval(this.lockHeartbeat);
      this.lockHeartbeat = undefined;
      await this.releaseLock();
      this.running = false;
    }
  }

  private async acquireLock() {
    const now = new Date();
    await this.prisma.simulationResearchReportGenerationLock.upsert({
      where: { id: LOCK_ID },
      create: { id: LOCK_ID },
      update: {},
    });
    const result =
      await this.prisma.simulationResearchReportGenerationLock.updateMany({
        where: {
          id: LOCK_ID,
          OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
        },
        data: {
          owner: this.owner,
          lockedUntil: new Date(now.getTime() + LOCK_TTL_MS),
        },
      });
    return result.count === 1;
  }

  private async releaseLock() {
    await this.prisma.simulationResearchReportGenerationLock.updateMany({
      where: { id: LOCK_ID, owner: this.owner },
      data: { owner: null, lockedUntil: null },
    });
  }

  private async extendLock() {
    await this.prisma.simulationResearchReportGenerationLock.updateMany({
      where: { id: LOCK_ID, owner: this.owner },
      data: { lockedUntil: new Date(Date.now() + LOCK_TTL_MS) },
    });
  }
}

import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SimulationStatus } from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { getReadableError } from 'src/utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { SimulationEvaluatorTaskService } from '../simulationEvaluator/simulation-evaluator-task.service';
import { DistributedSimulationEvaluatorService } from './distributed-simulation-evaluator.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import {
  buildAutomationHorizon,
  filterReadyAutomationRanges,
  isAutomationStatusEligible,
} from './utils/simulation-automation-queue.utils';
import {
  buildSimulationRanges,
  WindowRange,
} from './utils/simulation-range.utils';

const LEADER_SCORING_WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const RETRY_BASE_DELAY_MS = 60_000;
const RETRY_MAX_DELAY_MS = 60 * 60_000;
const RETRY_ALERT_THRESHOLD = 5;

/**
 * Experimental worker-driven research flow. This owns worker concurrency and
 * dynamic evaluation; the stable research runner remains centralized.
 */
@Injectable()
export class SimulationResearchDynamicAutoRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationAutoRunnerService: SimulationAutoRunnerService,
    private readonly evaluatorTasks: SimulationEvaluatorTaskService,
    private readonly distributedSimulationEvaluatorService: DistributedSimulationEvaluatorService,
    private readonly logger: LogsService,
    @Optional()
    @Inject(SERVICE_NAMES.REDIS_SERVICE)
    private readonly redisClient?: ClientProxy,
  ) {}

  async playAutomaticResearch(
    id: number,
    now = new Date(),
    leaseToken?: string,
  ): Promise<void> {
    const baseLabel = `[simulation:research-dynamic:${id}]`;
    const totalLabel = `${baseLabel} playAutomaticResearch total`;
    console.time(totalLabel);

    let retryAttempts = 0;
    try {
      const research = await this.prisma.simulationResearch.findUnique({
        where: { id },
        include: {
          simulations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      });
      if (!research) return;
      retryAttempts = research.retryAttempts;

      const allRanges = buildSimulationRanges(
        research.startAt,
        research.endAt,
        {
          days: research.days,
          gapDays: research.gapDays,
        },
      );
      const readyRanges = filterReadyAutomationRanges(
        allRanges,
        research.cursor,
        buildAutomationHorizon(research.endAt, now),
      );
      if (!readyRanges.length) {
        await this.finishOrPause(id, research.cursor, allRanges, leaseToken);
        return;
      }

      const contextLabel = `${baseLabel} load range context`;
      console.time(contextLabel);
      let context: Awaited<
        ReturnType<
          SimulationAutoRunnerService['loadSimulationRangeProcessingContext']
        >
      >;
      try {
        context =
          await this.simulationAutoRunnerService.loadSimulationRangeProcessingContext(
            research.platform,
            allRanges,
          );
      } finally {
        console.timeEnd(contextLabel);
      }
      let latestRange: WindowRange | null = null;

      for (const [rangeIndex, range] of readyRanges.entries()) {
        const rangeLabel = `${baseLabel} range ${rangeIndex + 1}/${readyRanges.length} ${range.startedAt.toISOString().slice(0, 10)}`;
        console.time(`${rangeLabel} total`);

        try {
          const currentResearch =
            await this.prisma.simulationResearch.findUnique({
              where: { id },
              include: {
                simulations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
              },
            });
          if (
            !currentResearch ||
            currentResearch.status === SimulationStatus.Cancelled ||
            currentResearch.status === SimulationStatus.Paused
          ) {
            return;
          }

          await this.updateResearch(
            id,
            {
              totalRanges: allRanges.length,
              completedRanges: this.countCompletedRanges(
                allRanges,
                range.startedAt,
              ),
              progressPhase: 'dynamic-range-processing',
              progressMessage: 'Dispatching worker evaluation tasks',
            },
            leaseToken,
          );

          const workerCapacityLabel = `${rangeLabel} count ready workers`;
          console.time(workerCapacityLabel);
          let concurrency: number;
          try {
            concurrency = await this.evaluatorTasks.countReadyWorkers(
              currentResearch.platform,
              new Date(
                range.startedAt.getTime() - LEADER_SCORING_WINDOW_DAYS * DAY_MS,
              ),
              range.startedAt,
            );
          } finally {
            console.timeEnd(workerCapacityLabel);
          }
          if (concurrency === 0) {
            throw new Error(
              'No eligible simulation evaluator worker is currently available',
            );
          }

          const simulations = currentResearch.simulations.filter((simulation) =>
            isAutomationStatusEligible(simulation.status),
          );
          for (
            let offset = 0;
            offset < simulations.length;
            offset += concurrency
          ) {
            const batch = simulations.slice(offset, offset + concurrency);
            const batchLabel = `${rangeLabel} dispatch batch ${Math.floor(offset / concurrency) + 1} (${batch.length} simulations)`;
            console.time(batchLabel);
            try {
              await Promise.all(
                batch.map(async (simulation) => {
                  const processed =
                    await this.simulationAutoRunnerService.processSimulationRangeWithLeaderEvaluation(
                      simulation.id,
                      range,
                      context,
                      (currentSimulation, candidateLeaders) =>
                        this.distributedSimulationEvaluatorService.evaluateLeadersForRange(
                          currentSimulation,
                          candidateLeaders,
                          range,
                          context.contractById,
                        ),
                    );
                  if (processed) {
                    await this.simulationAutoRunnerService.aggregateSimulationThroughCursor(
                      processed.id,
                      allRanges,
                    );
                  }
                }),
              );
            } finally {
              console.timeEnd(batchLabel);
            }
          }

          latestRange = range;
          const completedRanges = this.countCompletedRanges(
            allRanges,
            range.endedAt,
          );
          await this.updateResearch(
            id,
            {
              cursor: range.endedAt,
              totalRanges: allRanges.length,
              completedRanges,
              progressPhase: 'dynamic-range-completed',
              progressMessage: `Completed dynamic range ${completedRanges} / ${allRanges.length}`,
              progressPercent: this.progress(completedRanges, allRanges.length),
              retryAttempts: 0,
              nextRetryAt: null,
            },
            leaseToken,
          );
        } finally {
          console.timeEnd(`${rangeLabel} total`);
        }
      }
      await this.finishOrPause(id, latestRange?.endedAt, allRanges, leaseToken);
    } catch (error) {
      const readableError = getReadableError(error);
      if (!this.isTransientDynamicFailure(error)) {
        await this.updateResearch(
          id,
          {
            status: SimulationStatus.Failed,
            progressPhase: 'dynamic-failed',
            progressMessage: 'Dynamic evaluation failed',
            lastError: readableError,
            finishedAt: new Date(),
            nextRetryAt: null,
          },
          leaseToken,
        );
        await this.logger.nativeLog({
          severity: 'Error',
          summary: 'analytics.simulationResearchDynamicAutoRunner>failed',
          details: `Research ${id} failed during dynamic evaluation: ${readableError}`,
        });
        return;
      }
      const nextRetryAttempts = retryAttempts + 1;
      const retryAt = new Date(
        Date.now() + this.retryDelayMs(nextRetryAttempts),
      );
      await this.updateResearch(
        id,
        {
          // Worker availability and task leases are infrastructure concerns. Keep
          // the cursor intact and return the research to the scheduler's
          // claimable state so a later cron pass resumes the same range.
          status: SimulationStatus.Paused,
          progressPhase: 'dynamic-retry-pending',
          progressMessage: `Dynamic evaluation interrupted; retry ${nextRetryAttempts} scheduled`,
          lastError: readableError,
          finishedAt: null,
          retryAttempts: nextRetryAttempts,
          nextRetryAt: retryAt,
        },
        leaseToken,
      );
      if (nextRetryAttempts === RETRY_ALERT_THRESHOLD) {
        await this.logger.nativeLog({
          severity: 'Warning',
          summary:
            'analytics.simulationResearchDynamicAutoRunner>retryThreshold',
          details: `Research ${id} has failed ${nextRetryAttempts} consecutive dynamic evaluation attempts. Next retry: ${retryAt.toISOString()}. Last error: ${readableError}`,
        });
      }
    } finally {
      console.timeEnd(totalLabel);
    }
  }

  private async finishOrPause(
    id: number,
    cursor: Date | null | undefined,
    ranges: WindowRange[],
    leaseToken?: string,
  ) {
    const completedRanges = cursor
      ? this.countCompletedRanges(ranges, cursor)
      : 0;
    const completed =
      ranges.length === 0 ||
      (Boolean(cursor) &&
        cursor!.getTime() >= (ranges.at(-1)?.endedAt.getTime() ?? 0));
    await this.updateResearch(
      id,
      {
        status: completed
          ? SimulationStatus.Completed
          : SimulationStatus.Paused,
        cursor: cursor ?? undefined,
        totalRanges: ranges.length,
        completedRanges,
        progressPhase: completed ? 'completed' : 'paused',
        progressMessage: completed
          ? 'Dynamic research automation completed'
          : 'Paused until more historical data is available',
        progressPercent: this.progress(completedRanges, ranges.length),
        ...(completed ? { finishedAt: new Date() } : {}),
      },
      leaseToken,
    );
  }

  private countCompletedRanges(ranges: WindowRange[], cursor: Date) {
    return ranges.filter((range) => range.endedAt.getTime() <= cursor.getTime())
      .length;
  }

  private progress(completed: number, total: number) {
    return total ? (completed / total) * 100 : 100;
  }

  private retryDelayMs(attempt: number) {
    return Math.min(
      RETRY_BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1),
      RETRY_MAX_DELAY_MS,
    );
  }

  private isTransientDynamicFailure(error: unknown) {
    const message = getReadableError(error);
    return (
      message ===
        'No eligible simulation evaluator worker is currently available' ||
      message === 'Simulation evaluator dispatcher is offline' ||
      /^Simulation evaluator task .+ timed out$/.test(message)
    );
  }

  private async updateResearch(
    id: number,
    data: Record<string, unknown>,
    leaseToken?: string,
  ) {
    const updated = await this.prisma.simulationResearch.updateMany({
      where: {
        id,
        ...(leaseToken ? { automationLeaseToken: leaseToken } : {}),
      },
      data: data as any,
    });
    if (!updated.count) return;
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id },
      include: { simulations: { select: { status: true } } },
    });
    if (!research) return;
    if (this.redisClient) {
      await this.redisClient.emit(
        PATTERNS.Simulations.SimulationResearchUpdated,
        {
          ...research,
          totalSimulations: research.simulations.length,
          completedSimulations: research.simulations.filter(
            (simulation) => simulation.status === SimulationStatus.Completed,
          ).length,
        },
      );
    }
  }
}

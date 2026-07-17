import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SimulationStatus } from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';
import { getReadableError } from 'src/utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { SimulationEvaluatorTaskService } from '../simulationEvaluator/simulation-evaluator-task.service';
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
    @Optional()
    @Inject(SERVICE_NAMES.REDIS_SERVICE)
    private readonly redisClient?: ClientProxy,
  ) {}

  async playAutomaticResearch(id: number, now = new Date()): Promise<void> {
    try {
      const research = await this.prisma.simulationResearch.findUnique({
        where: { id },
        include: {
          simulations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      });
      if (!research) return;

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
        await this.finishOrPause(id, research.cursor, allRanges);
        return;
      }

      const context =
        await this.simulationAutoRunnerService.loadSimulationRangeProcessingContext(
          research.platform,
          allRanges,
        );
      let latestRange: WindowRange | null = null;

      for (const range of readyRanges) {
        const currentResearch = await this.prisma.simulationResearch.findUnique(
          {
            where: { id },
            include: {
              simulations: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
            },
          },
        );
        if (
          !currentResearch ||
          currentResearch.status === SimulationStatus.Cancelled ||
          currentResearch.status === SimulationStatus.Paused
        ) {
          return;
        }

        await this.updateResearch(id, {
          totalRanges: allRanges.length,
          completedRanges: this.countCompletedRanges(
            allRanges,
            range.startedAt,
          ),
          progressPhase: 'dynamic-range-processing',
          progressMessage: 'Dispatching worker evaluation tasks',
        });

        const concurrency = Math.max(
          1,
          await this.evaluatorTasks.countReadyWorkers(
            currentResearch.platform,
            new Date(
              range.startedAt.getTime() - LEADER_SCORING_WINDOW_DAYS * DAY_MS,
            ),
            range.startedAt,
          ),
        );
        const simulations = currentResearch.simulations.filter((simulation) =>
          isAutomationStatusEligible(simulation.status),
        );
        for (
          let offset = 0;
          offset < simulations.length;
          offset += concurrency
        ) {
          await Promise.all(
            simulations
              .slice(offset, offset + concurrency)
              .map(async (simulation) => {
                const processed =
                  await this.simulationAutoRunnerService.processSimulationRangeDynamically(
                    simulation.id,
                    range,
                    context,
                  );
                if (processed) {
                  await this.simulationAutoRunnerService.aggregateSimulationThroughCursor(
                    processed.id,
                    allRanges,
                  );
                }
              }),
          );
        }

        latestRange = range;
        const completedRanges = this.countCompletedRanges(
          allRanges,
          range.endedAt,
        );
        await this.updateResearch(id, {
          cursor: range.endedAt,
          totalRanges: allRanges.length,
          completedRanges,
          progressPhase: 'dynamic-range-completed',
          progressMessage: `Completed dynamic range ${completedRanges} / ${allRanges.length}`,
          progressPercent: this.progress(completedRanges, allRanges.length),
        });
      }
      await this.finishOrPause(id, latestRange?.endedAt, allRanges);
    } catch (error) {
      await this.updateResearch(id, {
        status: SimulationStatus.Failed,
        progressPhase: 'dynamic-failed',
        progressMessage: 'Dynamic research automation failed',
        lastError: getReadableError(error),
        finishedAt: new Date(),
      });
    }
  }

  private async finishOrPause(
    id: number,
    cursor: Date | null | undefined,
    ranges: WindowRange[],
  ) {
    const completedRanges = cursor
      ? this.countCompletedRanges(ranges, cursor)
      : 0;
    const completed =
      ranges.length === 0 ||
      (Boolean(cursor) &&
        cursor!.getTime() >= (ranges.at(-1)?.endedAt.getTime() ?? 0));
    await this.updateResearch(id, {
      status: completed ? SimulationStatus.Completed : SimulationStatus.Paused,
      cursor: cursor ?? undefined,
      totalRanges: ranges.length,
      completedRanges,
      progressPhase: completed ? 'completed' : 'paused',
      progressMessage: completed
        ? 'Dynamic research automation completed'
        : 'Paused until more historical data is available',
      progressPercent: this.progress(completedRanges, ranges.length),
      ...(completed ? { finishedAt: new Date() } : {}),
    });
  }

  private countCompletedRanges(ranges: WindowRange[], cursor: Date) {
    return ranges.filter((range) => range.endedAt.getTime() <= cursor.getTime())
      .length;
  }

  private progress(completed: number, total: number) {
    return total ? (completed / total) * 100 : 100;
  }

  private async updateResearch(id: number, data: Record<string, unknown>) {
    const research = await this.prisma.simulationResearch.update({
      where: { id },
      data: data as any,
      include: { simulations: { select: { status: true } } },
    });
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

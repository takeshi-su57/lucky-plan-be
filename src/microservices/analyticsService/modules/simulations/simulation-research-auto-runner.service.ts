import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { SimulationStatus } from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';

import { getReadableError } from 'src/utils';
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
import { SimulationLeaderEventLogCacheService } from './simulation-leader-event-log-cache.service';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

const LEADER_SCORING_WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;
const PREBUILD_PROGRESS_PERCENT = 10;

@Injectable()
export class SimulationResearchAutoRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationAutoRunnerService: SimulationAutoRunnerService,
    private readonly leaderEventLogCacheService: SimulationLeaderEventLogCacheService,
    @Optional()
    @Inject(SERVICE_NAMES.REDIS_SERVICE)
    private readonly redisClient?: ClientProxy,
  ) {}

  async playAutomaticResearch(id: number, now = new Date()): Promise<void> {
    const baseLabel = `[simulation:research-auto:${id}]`;
    const totalLabel = `${baseLabel} playAutomaticResearch total`;
    console.time(totalLabel);

    try {
      const research = await this.prisma.simulationResearch.findUnique({
        where: { id },
        include: {
          simulations: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      });

      if (!research) {
        return;
      }

      const allRanges = buildSimulationRanges(
        research.startAt,
        research.endAt,
        {
          days: research.days,
          gapDays: research.gapDays,
        },
      );
      const horizon = buildAutomationHorizon(research.endAt, now);
      const readyRanges = filterReadyAutomationRanges(
        allRanges,
        research.cursor,
        horizon,
      );

      if (readyRanges.length === 0) {
        await this.pauseOrCompleteResearch(id, research.cursor, allRanges);
        return;
      }

      const cacheLabel = `${baseLabel} prepare event-log cache`;
      console.time(cacheLabel);
      await this.leaderEventLogCacheService.prebuildForResearch(
        research.platform,
        new Date(
          research.startAt.getTime() - LEADER_SCORING_WINDOW_DAYS * DAY_MS,
        ),
        research.endAt,
        {
          onProgress: async (progress) => {
            await this.updateAndEmitResearch(id, {
              progressPhase: 'prebuilding-event-log-cache',
              progressMessage: `Prebuilding event-log cache ${progress.completedAddresses} / ${progress.totalAddresses} leaders`,
              progressPercent: this.getPrebuildProgressPercent(
                progress.completedAddressBatches,
                progress.totalAddressBatches,
              ),
              totalRanges: allRanges.length,
            });
          },
        },
      );
      console.timeEnd(cacheLabel);

      const contextLabel = `${baseLabel} load range context`;
      console.time(contextLabel);
      const context =
        await this.simulationAutoRunnerService.loadSimulationRangeProcessingContext(
          research.platform,
          allRanges,
        );
      console.timeEnd(contextLabel);

      let latestRange: WindowRange | null = null;

      for (const [rangeIndex, range] of readyRanges.entries()) {
        const rangeLabel = `${baseLabel} range ${rangeIndex + 1}/${
          readyRanges.length
        } ${range.startedAt.toISOString().slice(0, 10)}`;
        console.time(`${rangeLabel} total`);

        try {
          const currentResearch =
            await this.prisma.simulationResearch.findUnique({
              where: { id },
              include: {
                simulations: {
                  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
                },
              },
            });

          if (
            !currentResearch ||
            currentResearch.status === SimulationStatus.Cancelled ||
            currentResearch.status === SimulationStatus.Paused
          ) {
            return;
          }

          await this.updateResearchProgress(id, range, allRanges);

          const simulationsLabel = `${rangeLabel} process simulations`;
          console.time(simulationsLabel);
          const eligibleSimulations = currentResearch.simulations.filter(
            (simulation) => isAutomationStatusEligible(simulation.status),
          );
          for (const simulation of eligibleSimulations) {
            const processed =
              await this.simulationAutoRunnerService.processSimulationRange(
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
          }
          console.timeEnd(simulationsLabel);

          latestRange = range;

          const completedRanges = this.countCompletedRanges(
            allRanges,
            range.endedAt,
          );

          await this.updateAndEmitResearch(id, {
            cursor: range.endedAt,
            completedRanges,
            totalRanges: allRanges.length,
            progressPhase: 'range-completed',
            progressMessage: `Completed range ${completedRanges} / ${allRanges.length}`,
            progressPercent: this.getResearchProgressPercent(
              completedRanges,
              allRanges.length,
            ),
          });
        } finally {
          console.timeEnd(`${rangeLabel} total`);
        }
      }

      await this.finalizeResearch(id, latestRange, allRanges);

      return;
    } catch (error) {
      await this.failResearch(id, error);
      return;
    } finally {
      console.timeEnd(totalLabel);
    }
  }

  private async pauseOrCompleteResearch(
    id: number,
    cursor: Date | null,
    allRanges: WindowRange[],
  ) {
    const completedRanges = cursor
      ? this.countCompletedRanges(allRanges, cursor)
      : 0;
    const completed =
      allRanges.length === 0 ||
      (cursor !== null &&
        allRanges.at(-1) !== undefined &&
        cursor.getTime() >= allRanges.at(-1)!.endedAt.getTime());

    await this.updateAndEmitResearch(id, {
      status: completed ? SimulationStatus.Completed : SimulationStatus.Paused,
      progressPhase: completed ? 'completed' : 'paused',
      progressMessage: completed
        ? 'Research automation completed'
        : 'Paused until more historical data is available',
      progressPercent: this.getProgressPercent(
        completedRanges,
        allRanges.length,
      ),
      totalRanges: allRanges.length,
      ...(completed
        ? {
            completedRanges,
            finishedAt: new Date(),
          }
        : {}),
    });
  }

  private async updateResearchProgress(
    id: number,
    range: WindowRange,
    allRanges: WindowRange[],
  ) {
    const completedRanges = this.countCompletedRanges(
      allRanges,
      range.startedAt,
    );

    await this.updateAndEmitResearch(id, {
      totalRanges: allRanges.length,
      completedRanges,
      progressPhase: 'range-processing',
      progressMessage: `Processing range ${completedRanges + 1} / ${
        allRanges.length
      }`,
      progressPercent: this.getResearchProgressPercent(
        completedRanges,
        allRanges.length,
      ),
    });
  }

  private async finalizeResearch(
    id: number,
    latestRange: WindowRange | null,
    allRanges: WindowRange[],
  ) {
    const completedRanges = latestRange
      ? this.countCompletedRanges(allRanges, latestRange.endedAt)
      : 0;
    const completed =
      latestRange !== null &&
      allRanges.at(-1) !== undefined &&
      latestRange.endedAt.getTime() >= allRanges.at(-1)!.endedAt.getTime();

    await this.updateAndEmitResearch(id, {
      status: completed ? SimulationStatus.Completed : SimulationStatus.Paused,
      cursor: latestRange?.endedAt ?? undefined,
      completedRanges,
      totalRanges: allRanges.length,
      progressPhase: completed ? 'completed' : 'paused',
      progressMessage: completed
        ? 'Research automation completed'
        : 'Paused until more historical data is available',
      progressPercent: completed
        ? 100
        : this.getResearchProgressPercent(completedRanges, allRanges.length),
      ...(completed ? { finishedAt: new Date() } : {}),
    });
  }

  private async failResearch(id: number, error: unknown) {
    await this.updateAndEmitResearch(id, {
      status: SimulationStatus.Failed,
      progressPhase: 'failed',
      progressMessage: 'Research automation failed',
      lastError: getReadableError(error),
      finishedAt: new Date(),
    });
  }

  private countCompletedRanges(ranges: WindowRange[], cursor: Date) {
    return ranges.filter((range) => range.endedAt.getTime() <= cursor.getTime())
      .length;
  }

  private getProgressPercent(completedRanges: number, totalRanges: number) {
    if (totalRanges === 0) {
      return 100;
    }

    return (completedRanges / totalRanges) * 100;
  }

  private getPrebuildProgressPercent(
    completedAddressBatches: number,
    totalAddressBatches: number,
  ) {
    return Math.min(
      PREBUILD_PROGRESS_PERCENT,
      this.getProgressPercent(completedAddressBatches, totalAddressBatches) *
        (PREBUILD_PROGRESS_PERCENT / 100),
    );
  }

  private getResearchProgressPercent(
    completedRanges: number,
    totalRanges: number,
  ) {
    return (
      PREBUILD_PROGRESS_PERCENT +
      this.getProgressPercent(completedRanges, totalRanges) *
        ((100 - PREBUILD_PROGRESS_PERCENT) / 100)
    );
  }

  private async updateAndEmitResearch(
    id: number,
    data: Record<string, unknown>,
  ) {
    const research = await this.prisma.simulationResearch.update({
      where: { id },
      data: data as any,
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });

    await this.emitSimulationResearchUpdated(research);

    return research;
  }

  private async emitSimulationResearchUpdated(research: any) {
    if (!this.redisClient) {
      return;
    }

    const simulations = research.simulations || [];

    await this.redisClient.emit(
      PATTERNS.Simulations.SimulationResearchUpdated,
      {
        ...research,
        totalSimulations: simulations.length,
        completedSimulations: simulations.filter(
          (simulation: { status: SimulationStatus }) =>
            simulation.status === SimulationStatus.Completed,
        ).length,
      },
    );
  }
}

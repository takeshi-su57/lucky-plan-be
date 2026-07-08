import { Injectable } from '@nestjs/common';
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

const LEADER_SCORING_WINDOW_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SimulationResearchAutoRunnerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationAutoRunnerService: SimulationAutoRunnerService,
    private readonly leaderEventLogCacheService: SimulationLeaderEventLogCacheService,
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

      const cacheLabel = `${baseLabel} rebuild event-log cache`;
      console.time(cacheLabel);
      await this.leaderEventLogCacheService.registerResearchRange(
        research.platform,
        new Date(
          research.startAt.getTime() - LEADER_SCORING_WINDOW_DAYS * DAY_MS,
        ),
        research.endAt,
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
        const processedSimulationIds = new Set<number>();

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
          for (const simulation of currentResearch.simulations) {
            if (!isAutomationStatusEligible(simulation.status)) {
              continue;
            }

            const processed =
              await this.simulationAutoRunnerService.processSimulationRange(
                simulation.id,
                range,
                context,
              );

            if (!processed) {
              continue;
            }

            processedSimulationIds.add(simulation.id);
          }
          console.timeEnd(simulationsLabel);

          const aggregateLabel = `${rangeLabel} aggregate simulations`;
          console.time(aggregateLabel);
          for (const simulationId of processedSimulationIds) {
            await this.simulationAutoRunnerService.aggregateSimulationThroughCursor(
              simulationId,
              allRanges,
            );
          }
          console.timeEnd(aggregateLabel);

          latestRange = range;

          await this.prisma.simulationResearch.update({
            where: { id },
            data: {
              cursor: range.endedAt,
              completedRanges: this.countCompletedRanges(
                allRanges,
                range.endedAt,
              ),
              totalRanges: allRanges.length,
              progressPhase: 'range-completed',
              progressMessage: `Completed range ${this.countCompletedRanges(
                allRanges,
                range.endedAt,
              )} / ${allRanges.length}`,
              progressPercent: this.getProgressPercent(
                this.countCompletedRanges(allRanges, range.endedAt),
                allRanges.length,
              ),
            },
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
      const clearCacheLabel = `${baseLabel} clear event-log cache`;
      console.time(clearCacheLabel);
      await this.leaderEventLogCacheService.clear();
      console.timeEnd(clearCacheLabel);
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

    await this.prisma.simulationResearch.update({
      where: { id },
      data: {
        status: completed
          ? SimulationStatus.Completed
          : SimulationStatus.Paused,
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
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
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

    await this.prisma.simulationResearch.update({
      where: { id },
      data: {
        totalRanges: allRanges.length,
        completedRanges,
        progressPhase: 'range-processing',
        progressMessage: `Processing range ${completedRanges + 1} / ${
          allRanges.length
        }`,
        progressPercent: this.getProgressPercent(
          completedRanges,
          allRanges.length,
        ),
      },
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

    await this.prisma.simulationResearch.update({
      where: { id },
      data: {
        status: completed
          ? SimulationStatus.Completed
          : SimulationStatus.Paused,
        cursor: latestRange?.endedAt ?? undefined,
        completedRanges,
        totalRanges: allRanges.length,
        progressPhase: completed ? 'completed' : 'paused',
        progressMessage: completed
          ? 'Research automation completed'
          : 'Paused until more historical data is available',
        progressPercent: completed
          ? 100
          : this.getProgressPercent(completedRanges, allRanges.length),
        ...(completed ? { finishedAt: new Date() } : {}),
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
    });
  }

  private async failResearch(id: number, error: unknown) {
    await this.prisma.simulationResearch.update({
      where: { id },
      data: {
        status: SimulationStatus.Failed,
        progressPhase: 'failed',
        progressMessage: 'Research automation failed',
        lastError: getReadableError(error),
        finishedAt: new Date(),
      },
      include: {
        simulations: {
          select: {
            status: true,
          },
        },
      },
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
}

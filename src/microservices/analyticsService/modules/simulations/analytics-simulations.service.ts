import { Injectable } from '@nestjs/common';
import { SimulationStatus } from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';
import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';
import {
  buildAutomationHorizon,
  filterReadyAutomationRanges,
  isRunningSimulationStale,
  SIMULATION_AUTOMATION_STALE_AFTER_MS,
} from './simulation-automation-queue.utils';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { buildDailyRanges } from './simulation-range.utils';

@Injectable()
export class AnalyticsSimulationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationAutoRunnerService: SimulationAutoRunnerService,
  ) {}

  static getAutomationStatusPriority(status: SimulationStatus) {
    switch (status) {
      case SimulationStatus.Running:
        return 0;
      case SimulationStatus.Paused:
        return 1;
      case SimulationStatus.Created:
        return 2;
      default:
        return 99;
    }
  }

  async processNextQueuedAutoSimulation(
    now = new Date(),
  ): Promise<Simulation | null> {
    const candidates = await this.prisma.simulation.findMany({
      where: {
        status: {
          in: [
            SimulationStatus.Running,
            SimulationStatus.Paused,
            SimulationStatus.Created,
          ],
        },
      },
      orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
      take: 25,
    });

    const eligibleCandidates = candidates
      .filter((candidate) => {
        if (
          candidate.status === SimulationStatus.Running &&
          !isRunningSimulationStale({
            status: candidate.status,
            updatedAt: candidate.updatedAt,
            now,
            staleAfterMs: SIMULATION_AUTOMATION_STALE_AFTER_MS,
            isLocallyActive:
              this.simulationAutoRunnerService.isAutoSimulationActive(
                candidate.id,
              ),
          })
        ) {
          return false;
        }

        const allRanges = buildDailyRanges(candidate.startAt, candidate.endAt);
        const horizon = buildAutomationHorizon(candidate.endAt, now);
        const readyRanges = filterReadyAutomationRanges(
          allRanges,
          candidate.cursor,
          horizon,
        );

        return readyRanges.length > 0;
      })
      .sort((a, b) => {
        const priorityDiff =
          AnalyticsSimulationsService.getAutomationStatusPriority(a.status) -
          AnalyticsSimulationsService.getAutomationStatusPriority(b.status);

        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        return a.updatedAt.getTime() - b.updatedAt.getTime();
      });

    const simulation = eligibleCandidates[0];

    if (!simulation) {
      return null;
    }

    const horizon = buildAutomationHorizon(simulation.endAt, now);

    return this.simulationAutoRunnerService.playQueuedAutoSimulation(
      simulation.id,
      horizon,
    );
  }
}

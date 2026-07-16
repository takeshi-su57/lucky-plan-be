import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';

import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';
import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';
import { SimulationEvaluatorTaskService } from '../simulationEvaluator/simulation-evaluator-task.service';
import {
  CandidateEvaluation,
  ContractContext,
} from './simulation-leader-evaluator.service';
import { WindowRange } from './utils/simulation-range.utils';

const LEADER_SCORING_WINDOW_DAYS = 180;

@Injectable()
export class DistributedSimulationEvaluatorService {
  constructor(private readonly tasks: SimulationEvaluatorTaskService) {}

  async canEvaluateLeadersForRange(simulation: Simulation, range: WindowRange) {
    const requiredCacheStartAt = dayjs(range.startedAt)
      .subtract(LEADER_SCORING_WINDOW_DAYS, 'day')
      .toDate();
    const readyWorkers = await this.tasks.countReadyWorkers(
      simulation.platform,
      requiredCacheStartAt,
      range.startedAt,
    );
    return readyWorkers > 0;
  }

  async evaluateLeadersForRange(
    simulation: Simulation,
    candidateLeaders: string[],
    range: WindowRange,
    contractById: Map<number, ContractContext>,
  ): Promise<CandidateEvaluation[]> {
    const task = await this.tasks.createTask({
      kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
      simulationId: simulation.id,
      platform: simulation.platform,
      requiredCacheStartAt: dayjs(range.startedAt)
        .subtract(LEADER_SCORING_WINDOW_DAYS, 'day')
        .toDate(),
      requiredCacheEndAt: range.startedAt,
      rangeStartedAt: range.startedAt,
      rangeEndedAt: range.endedAt,
      input: JSON.parse(
        JSON.stringify({
          simulation,
          candidateLeaders,
          range: {
            startedAt: range.startedAt.toISOString(),
            endedAt: range.endedAt.toISOString(),
          },
          contracts: [...contractById.values()],
          platform: simulation.platform,
          eventLogWindowStartedAt: dayjs(range.startedAt)
            .subtract(LEADER_SCORING_WINDOW_DAYS, 'day')
            .toISOString(),
          eventLogWindowEndedAt: range.startedAt.toISOString(),
        }),
      ),
    });
    const completed = await this.tasks.waitForCompletedTask(task.id);
    const result = completed.result as {
      evaluatedCandidates?: CandidateEvaluation[];
    } | null;
    if (!Array.isArray(result?.evaluatedCandidates)) {
      throw new Error(`Evaluator task ${task.id} returned an invalid result`);
    }
    const candidateAddresses = new Set(
      candidateLeaders.map((address) => address.toLowerCase()),
    );
    if (
      result.evaluatedCandidates.some(
        (candidate) =>
          !candidateAddresses.has(candidate.leaderAddress.toLowerCase()) ||
          !Number.isFinite(candidate.score) ||
          !Number.isFinite(candidate.suggestedRatio) ||
          !Number.isFinite(candidate.suggestedCollateralUsd),
      )
    ) {
      throw new Error(
        `Evaluator task ${task.id} returned unauthorized or invalid candidates`,
      );
    }
    return result.evaluatedCandidates;
  }
}

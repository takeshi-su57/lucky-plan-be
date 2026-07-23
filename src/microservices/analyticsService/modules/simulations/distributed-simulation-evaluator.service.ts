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
import { SimulationWorkflowConfigService } from 'src/global/simulation-workflow-config.service';

export type SimulationEvaluationDispatchTiming = {
  findCandidateMs: number;
  loadRangeContextMs: number;
};

@Injectable()
export class DistributedSimulationEvaluatorService {
  constructor(
    private readonly tasks: SimulationEvaluatorTaskService,
    private readonly workflowConfig: SimulationWorkflowConfigService,
  ) {}

  async canEvaluateLeadersForRange(simulation: Simulation, range: WindowRange) {
    const readyWorkers = await this.tasks.countReadyWorkers(
      simulation.platform,
      range.startedAt,
      range.endedAt,
    );
    return readyWorkers > 0;
  }

  async evaluateLeadersForRange(
    simulation: Simulation,
    candidateLeaders: string[],
    range: WindowRange,
    contractById: Map<number, ContractContext>,
  ): Promise<CandidateEvaluation[]> {
    const task = await this.enqueueLeadersForRange(
      simulation,
      candidateLeaders,
      range,
      contractById,
    );
    const completed = await this.tasks.waitForCompletedTask(task.id);
    return this.readCompletedEvaluation(
      completed.result,
      task.id,
      candidateLeaders,
    );
  }

  async enqueueLeadersForRange(
    simulation: Simulation,
    candidateLeaders: string[],
    range: WindowRange,
    contractById: Map<number, ContractContext>,
    dispatchTiming?: SimulationEvaluationDispatchTiming,
  ) {
    const evaluationSimulation = {
      platform: simulation.platform,
      direction: simulation.direction,
      trade: simulation.trade,
      r2: simulation.r2,
      slope: simulation.slope,
      standardCollateralUsd: simulation.standardCollateralUsd,
      collateral: simulation.collateral,
      size: simulation.size,
      leverage: simulation.leverage,
      score: simulation.score,
      scoreFormular: simulation.scoreFormular,
      sizingFormular: simulation.sizingFormular,
    };
    const workflow = await this.workflowConfig.get();
    const eventLogWindowStartedAt = dayjs(range.startedAt)
      .subtract(workflow.leaderScoringWindowDays, 'day')
      .toDate();
    const eventLogWindowEndedAt = range.startedAt;
    return this.tasks.createTask({
      kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
      simulationId: simulation.id,
      platform: simulation.platform,
      // Prebuilt coverage only gates the individual plan window. Historical
      // scoring data outside that coverage is fetched on demand by the worker.
      requiredCacheStartAt: range.startedAt,
      requiredCacheEndAt: range.endedAt,
      rangeStartedAt: range.startedAt,
      rangeEndedAt: range.endedAt,
      input: JSON.parse(
        JSON.stringify({
          simulation: evaluationSimulation,
          candidateLeaders,
          range: {
            startedAt: range.startedAt.toISOString(),
            endedAt: range.endedAt.toISOString(),
          },
          contracts: [...contractById.values()],
          platform: simulation.platform,
          dispatchTiming,
          eventLogWindowStartedAt: eventLogWindowStartedAt.toISOString(),
          eventLogWindowEndedAt: eventLogWindowEndedAt.toISOString(),
        }),
      ),
    });
  }

  readCompletedEvaluation(
    rawResult: unknown,
    taskId: string,
    candidateLeaders: string[],
  ): CandidateEvaluation[] {
    const result = rawResult as {
      evaluatedCandidates?: CandidateEvaluation[];
    } | null;
    if (!Array.isArray(result?.evaluatedCandidates)) {
      throw new Error(`Evaluator task ${taskId} returned an invalid result`);
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
        `Evaluator task ${taskId} returned unauthorized or invalid candidates`,
      );
    }
    return result.evaluatedCandidates;
  }
}

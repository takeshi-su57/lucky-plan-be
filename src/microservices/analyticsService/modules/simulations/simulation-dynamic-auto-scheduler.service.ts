import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  SimulationEvaluatorTaskStatus,
  SimulationExecutionPlanStatus,
  SimulationStatus,
} from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationEvaluatorTaskService } from '../simulationEvaluator/simulation-evaluator-task.service';
import { DistributedSimulationEvaluatorService } from './distributed-simulation-evaluator.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { buildAutomationHorizon } from './utils/simulation-automation-queue.utils';
import {
  buildSimulationRanges,
  WindowRange,
} from './utils/simulation-range.utils';

export const MAX_OUTSTANDING_DYNAMIC_PLANS = 20;
const FINALIZER_BATCH_SIZE = 20;
const FINALIZER_LEASE_MS = 30 * 60_000;

type DispatchCandidate = {
  simulation: any;
  ranges: WindowRange[];
  undispatchedRanges: WindowRange[];
  outstanding: number;
  fairnessLoad: number;
};

export function allocateFairPlanSlots(
  candidates: Array<{
    simulationId: number;
    outstanding: number;
    availablePlans: number;
    order: number;
  }>,
  slots: number,
) {
  const state = candidates.map((candidate) => ({ ...candidate }));
  const allocation: number[] = [];
  while (allocation.length < slots) {
    const next = state
      .filter((candidate) => candidate.availablePlans > 0)
      .sort(
        (a, b) =>
          a.outstanding - b.outstanding ||
          a.order - b.order ||
          a.simulationId - b.simulationId,
      )[0];
    if (!next) break;
    allocation.push(next.simulationId);
    next.outstanding += 1;
    next.availablePlans -= 1;
  }
  return allocation;
}

@Injectable()
export class SimulationDynamicAutoSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: SimulationAutoRunnerService,
    private readonly distributedEvaluator: DistributedSimulationEvaluatorService,
    private readonly evaluatorTasks: SimulationEvaluatorTaskService,
  ) {}

  async processAvailableSimulations(now = new Date()) {
    await this.reconcileInterruptedPlans(now);
    await this.finalizeCompletedPlans(now);
    await this.fillEvaluatorQueue(now);
  }

  private async fillEvaluatorQueue(now: Date) {
    const simulations = await this.prisma.simulation.findMany({
      where: {
        research: {
          is: {
            automationEnabled: true,
            status: {
              notIn: [SimulationStatus.Cancelled, SimulationStatus.Completed],
            },
          },
        },
        status: {
          notIn: [
            SimulationStatus.Cancelled,
            SimulationStatus.Completed,
            SimulationStatus.Failed,
          ],
        },
      },
      include: { research: true, executionPlans: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    });
    if (!simulations.length) return;

    const candidates: DispatchCandidate[] = simulations.flatMap(
      (simulation) => {
        const ranges = buildSimulationRanges(
          simulation.startAt,
          simulation.endAt,
          {
            days: simulation.days,
            gapDays: simulation.gapDays,
          },
        );
        const horizon = buildAutomationHorizon(simulation.endAt, now);
        const existingKeys = new Set(
          simulation.executionPlans
            .filter((plan) =>
              [
                SimulationExecutionPlanStatus.Dispatched,
                SimulationExecutionPlanStatus.Finalizing,
                SimulationExecutionPlanStatus.Completed,
              ].some((status) => status === plan.status),
            )
            .map((plan) =>
              this.rangeKey(plan.rangeStartedAt, plan.rangeEndedAt),
            ),
        );
        const undispatchedRanges = ranges.filter(
          (range) =>
            range.endedAt <= horizon &&
            !existingKeys.has(this.rangeKey(range.startedAt, range.endedAt)),
        );
        const outstanding = simulation.executionPlans.filter(
          (plan) =>
            plan.status === SimulationExecutionPlanStatus.Pending ||
            plan.status === SimulationExecutionPlanStatus.Dispatched ||
            plan.status === SimulationExecutionPlanStatus.Finalizing,
        ).length;
        return undispatchedRanges.length
          ? [
              {
                simulation,
                ranges,
                undispatchedRanges,
                outstanding,
                fairnessLoad: simulation.completedPlans + outstanding,
              },
            ]
          : [];
      },
    );
    if (!candidates.length) return;

    const first = candidates[0];
    const workerCapacity = await this.evaluatorTasks.countReadyWorkers(
      first.simulation.platform,
      new Date(
        first.undispatchedRanges[0].startedAt.getTime() - 180 * 86_400_000,
      ),
      first.undispatchedRanges[0].startedAt,
      true,
    );
    const target = Math.min(MAX_OUTSTANDING_DYNAMIC_PLANS, workerCapacity);
    const outstanding = await this.prisma.simulationExecutionPlan.count({
      where: {
        status: {
          in: [
            SimulationExecutionPlanStatus.Pending,
            SimulationExecutionPlanStatus.Dispatched,
            SimulationExecutionPlanStatus.Finalizing,
          ],
        },
      },
    });
    let deficit = Math.max(0, target - outstanding);

    const allocation = allocateFairPlanSlots(
      candidates.map((candidate, order) => ({
        simulationId: candidate.simulation.id,
        outstanding: candidate.fairnessLoad,
        availablePlans: candidate.undispatchedRanges.length,
        order,
      })),
      deficit,
    );
    for (const simulationId of allocation) {
      const candidate = candidates.find(
        (item) => item.simulation.id === simulationId,
      );
      if (!candidate) continue;
      const range = candidate.undispatchedRanges.shift()!;
      const dispatched = await this.dispatchPlan(
        candidate.simulation,
        range,
        candidate.ranges,
      );
      if (dispatched) {
        candidate.outstanding += 1;
        candidate.fairnessLoad += 1;
        deficit -= 1;
      }
    }
    await Promise.all(
      [
        ...new Set(
          candidates.map((candidate) => candidate.simulation.researchId),
        ),
      ].map((researchId) => this.syncResearch(researchId)),
    );
  }

  private async dispatchPlan(
    simulationRecord: any,
    range: WindowRange,
    ranges: WindowRange[],
  ) {
    let executionPlan = await this.prisma.simulationExecutionPlan.upsert({
      where: {
        simulationId_rangeStartedAt_rangeEndedAt: {
          simulationId: simulationRecord.id,
          rangeStartedAt: range.startedAt,
          rangeEndedAt: range.endedAt,
        },
      },
      update: {},
      create: {
        simulationId: simulationRecord.id,
        rangeStartedAt: range.startedAt,
        rangeEndedAt: range.endedAt,
      },
    });
    if (
      executionPlan.status === SimulationExecutionPlanStatus.Failed &&
      executionPlan.attempts < 5
    ) {
      executionPlan = await this.prisma.simulationExecutionPlan.update({
        where: { id: executionPlan.id },
        data: {
          status: SimulationExecutionPlanStatus.Pending,
          evaluatorTaskId: null,
          lastError: null,
        },
      });
    }
    if (executionPlan.status !== SimulationExecutionPlanStatus.Pending)
      return false;

    try {
      const prepared = await this.runner.findCandidateLeadersForRange(
        simulationRecord.id,
        range,
      );
      if (!prepared) return false;
      const context = await this.runner.loadSimulationRangeProcessingContext(
        prepared.simulation.platform,
        ranges,
      );
      const task = await this.distributedEvaluator.enqueueLeadersForRange(
        prepared.simulation,
        prepared.candidateLeaders,
        range,
        context.contractById,
      );
      await this.prisma.$transaction([
        this.prisma.simulationExecutionPlan.update({
          where: { id: executionPlan.id },
          data: {
            status: SimulationExecutionPlanStatus.Dispatched,
            evaluatorTaskId: task.id,
            dispatchedAt: new Date(),
            lastError: null,
          },
        }),
        this.prisma.simulation.update({
          where: { id: simulationRecord.id },
          data: {
            status: SimulationStatus.Running,
            progressPhase: 'dynamic-plans-dispatched',
            progressMessage: 'Evaluator plan tasks are running',
          },
        }),
        this.prisma.simulationResearch.update({
          where: { id: simulationRecord.researchId },
          data: {
            status: SimulationStatus.Running,
            startedAt: simulationRecord.research.startedAt ?? new Date(),
            progressPhase: 'dynamic-plan-scheduling',
            progressMessage: 'Dispatching plan tasks across worker slots',
          },
        }),
      ]);
      return true;
    } catch (error) {
      await this.prisma.simulationExecutionPlan.update({
        where: { id: executionPlan.id },
        data: {
          status: SimulationExecutionPlanStatus.Failed,
          attempts: { increment: 1 },
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
      return false;
    }
  }

  private async finalizeCompletedPlans(now: Date) {
    const plans = await this.prisma.simulationExecutionPlan.findMany({
      where: {
        status: SimulationExecutionPlanStatus.Dispatched,
        simulation: {
          is: {
            status: { not: SimulationStatus.Cancelled },
            research: { is: { status: { not: SimulationStatus.Cancelled } } },
          },
        },
        evaluatorTask: {
          is: { status: SimulationEvaluatorTaskStatus.Completed },
        },
      },
      include: {
        evaluatorTask: true,
        simulation: { include: { research: true } },
      },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: FINALIZER_BATCH_SIZE,
    });
    await Promise.all(plans.map((plan) => this.finalizePlan(plan, now)));
  }

  private async finalizePlan(plan: any, now: Date) {
    const leaseToken = randomUUID();
    const claim = await this.prisma.simulationExecutionPlan.updateMany({
      where: { id: plan.id, status: SimulationExecutionPlanStatus.Dispatched },
      data: {
        status: SimulationExecutionPlanStatus.Finalizing,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + FINALIZER_LEASE_MS),
      },
    });
    if (!claim.count) return;
    try {
      const range = {
        startedAt: plan.rangeStartedAt,
        endedAt: plan.rangeEndedAt,
      };
      const ranges = buildSimulationRanges(
        plan.simulation.startAt,
        plan.simulation.endAt,
        {
          days: plan.simulation.days,
          gapDays: plan.simulation.gapDays,
        },
      );
      const context = await this.runner.loadSimulationRangeProcessingContext(
        plan.simulation.platform,
        ranges,
      );
      const taskInput = plan.evaluatorTask.input as {
        candidateLeaders?: string[];
      };
      const evaluated = this.distributedEvaluator.readCompletedEvaluation(
        plan.evaluatorTask.result,
        plan.evaluatorTask.id,
        taskInput.candidateLeaders ?? [],
      );
      await this.runner.finalizeSimulationRange(
        plan.simulationId,
        range,
        context,
        evaluated,
      );
      await this.prisma.simulationExecutionPlan.updateMany({
        where: { id: plan.id, leaseToken },
        data: {
          status: SimulationExecutionPlanStatus.Completed,
          completedAt: new Date(),
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      await this.syncResearch(plan.simulation.researchId);
    } catch (error) {
      await this.prisma.simulationExecutionPlan.updateMany({
        where: { id: plan.id, leaseToken },
        data: {
          status: SimulationExecutionPlanStatus.Failed,
          attempts: { increment: 1 },
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  private async reconcileInterruptedPlans(now: Date) {
    await this.prisma.simulationExecutionPlan.updateMany({
      where: {
        status: SimulationExecutionPlanStatus.Finalizing,
        leaseExpiresAt: { lte: now },
      },
      data: {
        status: SimulationExecutionPlanStatus.Dispatched,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    const failedTasks = await this.prisma.simulationExecutionPlan.findMany({
      where: {
        status: SimulationExecutionPlanStatus.Dispatched,
        evaluatorTask: {
          is: {
            status: {
              in: [
                SimulationEvaluatorTaskStatus.Failed,
                SimulationEvaluatorTaskStatus.Cancelled,
              ],
            },
          },
        },
      },
      select: { id: true },
    });
    await Promise.all(
      failedTasks.map((plan) =>
        this.prisma.simulationExecutionPlan.update({
          where: { id: plan.id },
          data: {
            status: SimulationExecutionPlanStatus.Failed,
            attempts: { increment: 1 },
            evaluatorTaskId: null,
            lastError: 'Evaluator task failed; plan can be retried',
          },
        }),
      ),
    );
  }

  private async syncResearch(researchId: number) {
    const research = await this.prisma.simulationResearch.findUnique({
      where: { id: researchId },
      include: {
        simulations: {
          select: {
            totalSimulationPlans: true,
            completedPlans: true,
            executionPlans: {
              select: {
                status: true,
                evaluatorTask: { select: { status: true } },
              },
            },
          },
        },
      },
    });
    if (!research) return;
    const totalPlans = research.simulations.reduce(
      (sum, item) => sum + item.totalSimulationPlans,
      0,
    );
    const completedPlans = research.simulations.reduce(
      (sum, item) => sum + item.completedPlans,
      0,
    );
    const completed = totalPlans === 0 || completedPlans >= totalPlans;
    const executionPlans = research.simulations.flatMap(
      (simulation) => simulation.executionPlans,
    );
    const outstandingPlans = executionPlans.filter((plan) =>
      [
        SimulationExecutionPlanStatus.Pending,
        SimulationExecutionPlanStatus.Dispatched,
        SimulationExecutionPlanStatus.Finalizing,
      ].some((status) => status === plan.status),
    ).length;
    const queuedPlans = executionPlans.filter(
      (plan) =>
        plan.status === SimulationExecutionPlanStatus.Pending ||
        (plan.status === SimulationExecutionPlanStatus.Dispatched &&
          (plan.evaluatorTask?.status ===
            SimulationEvaluatorTaskStatus.Queued ||
            plan.evaluatorTask?.status ===
              SimulationEvaluatorTaskStatus.Ready)),
    ).length;
    const runningPlans = executionPlans.filter(
      (plan) =>
        plan.status === SimulationExecutionPlanStatus.Dispatched &&
        plan.evaluatorTask?.status === SimulationEvaluatorTaskStatus.Claimed,
    ).length;
    const finalizingPlans = executionPlans.filter(
      (plan) =>
        plan.status === SimulationExecutionPlanStatus.Finalizing ||
        (plan.status === SimulationExecutionPlanStatus.Dispatched &&
          plan.evaluatorTask?.status ===
            SimulationEvaluatorTaskStatus.Completed),
    ).length;
    await this.prisma.simulationResearch.update({
      where: { id: researchId },
      data: {
        status: completed
          ? SimulationStatus.Completed
          : SimulationStatus.Running,
        totalPlans,
        completedPlans,
        outstandingPlans,
        queuedPlans,
        runningPlans,
        finalizingPlans,
        progressPercent: totalPlans ? (completedPlans / totalPlans) * 100 : 100,
        progressPhase: completed ? 'completed' : 'dynamic-plan-scheduling',
        progressMessage: completed
          ? 'All simulation plan windows completed'
          : `${completedPlans} / ${totalPlans} simulation plans completed`,
        ...(completed ? { finishedAt: new Date() } : {}),
      },
    });
    const simulation = await this.prisma.simulation.findFirst({
      where: { researchId },
    });
    if (simulation) await this.runner.emitSimulationUpdated(simulation);
  }

  private rangeKey(startedAt: Date, endedAt: Date) {
    return `${startedAt.toISOString()}:${endedAt.toISOString()}`;
  }
}

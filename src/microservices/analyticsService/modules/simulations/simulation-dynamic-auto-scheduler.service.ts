import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  SimulationEvaluatorTaskKind,
  SimulationEvaluatorTaskStatus,
  SimulationExecutionPlanStatus,
  SimulationStatus,
} from 'generated/prisma/enums';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { SimulationWorkflowConfigService } from 'src/global/simulation-workflow-config.service';
import { SimulationEvaluatorTaskService } from '../simulationEvaluator/simulation-evaluator-task.service';
import { SIMULATION_EVALUATOR } from '../simulationEvaluator/simulation-evaluator.constants';
import { DistributedSimulationEvaluatorService } from './distributed-simulation-evaluator.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { buildAutomationHorizon } from './utils/simulation-automation-queue.utils';
import {
  buildSimulationRanges,
  WindowRange,
} from './utils/simulation-range.utils';

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

export function calculateEvaluatorQueueRefill(
  workerCapacity: number,
  availableTasks: number,
  outstandingPlans: number,
  maxOutstandingPlans: number,
  awaitingFinalizationPlans = 0,
  maxAwaitingFinalizationPlans = Number.POSITIVE_INFINITY,
) {
  if (awaitingFinalizationPlans >= maxAwaitingFinalizationPlans) return 0;
  const lowWatermark =
    workerCapacity * SIMULATION_EVALUATOR.queueLowWatermarkCapacityMultiplier;
  if (availableTasks >= lowWatermark) return 0;

  const highWatermark =
    workerCapacity * SIMULATION_EVALUATOR.queueHighWatermarkCapacityMultiplier;
  return Math.max(
    0,
    Math.min(
      highWatermark - availableTasks,
      maxOutstandingPlans - outstandingPlans,
    ),
  );
}

@Injectable()
export class SimulationDynamicAutoSchedulerService {
  private finalizerDispatchRunning = false;
  private readonly activeFinalizerPlans = new Set<string>();
  private readonly activeFinalizerSimulations = new Set<number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: SimulationAutoRunnerService,
    private readonly distributedEvaluator: DistributedSimulationEvaluatorService,
    private readonly evaluatorTasks: SimulationEvaluatorTaskService,
    private readonly logger: LogsService,
    private readonly workflowConfig: SimulationWorkflowConfigService,
  ) {}

  async processAvailableSimulations(now = new Date()) {
    await this.processQueueMaintenance(now);
    await this.processFinalizations(now);
  }

  async processQueueMaintenance(now = new Date()) {
    await this.reconcileInterruptedPlans(now);
    await this.fillEvaluatorQueue(now);
    // A shutdown can happen after finalizeSimulationRange has persisted the
    // simulation result but before this service has marked the execution plan
    // complete and refreshed the research counters.  Do not make convergence
    // depend on there being another range to dispatch: a fully dispatched
    // research has no candidates, which used to leave that stale state forever.
    await this.reconcileResearchProgress();
  }

  async processFinalizations(now = new Date()) {
    await this.reconcileInterruptedPlans(now);
    await this.dispatchCompletedPlans(now);
  }

  private async reconcileResearchProgress() {
    const researchIds = await this.prisma.simulationResearch.findMany({
      where: {
        automationEnabled: true,
        status: {
          notIn: [SimulationStatus.Cancelled, SimulationStatus.Completed],
        },
      },
      select: { id: true },
    });

    await Promise.all(researchIds.map(({ id }) => this.syncResearch(id)));
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
                SimulationExecutionPlanStatus.AwaitingEventLogs,
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
            plan.status === SimulationExecutionPlanStatus.AwaitingEventLogs ||
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
      first.simulation.startAt,
      first.simulation.endAt,
      true,
    );
    const workflow = await this.workflowConfig.get();
    const outstanding = await this.prisma.simulationExecutionPlan.count({
      where: {
        status: {
          in: [
            SimulationExecutionPlanStatus.Pending,
            SimulationExecutionPlanStatus.Dispatched,
            SimulationExecutionPlanStatus.AwaitingEventLogs,
            SimulationExecutionPlanStatus.Finalizing,
          ],
        },
      },
    });
    const availableTasks = await this.prisma.simulationEvaluatorTask.count({
      where: {
        kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
        status: {
          in: [
            SimulationEvaluatorTaskStatus.Queued,
            SimulationEvaluatorTaskStatus.Ready,
          ],
        },
      },
    });
    const awaitingFinalization =
      await this.prisma.simulationExecutionPlan.count({
        where: {
          OR: [
            {
              status: SimulationExecutionPlanStatus.Dispatched,
              evaluatorTask: {
                is: { status: SimulationEvaluatorTaskStatus.Completed },
              },
            },
            {
              status: {
                in: [
                  SimulationExecutionPlanStatus.AwaitingEventLogs,
                  SimulationExecutionPlanStatus.Finalizing,
                ],
              },
            },
          ],
        },
      });
    let deficit = calculateEvaluatorQueueRefill(
      workerCapacity,
      availableTasks,
      outstanding,
      workflow.maxOutstandingDynamicPlans,
      awaitingFinalization,
      workflow.maxAwaitingFinalizationPlans,
    );

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
      const findCandidateStartedAt = performance.now();
      const prepared = await this.runner.findCandidateLeadersForRange(
        simulationRecord.id,
        range,
      );
      const findCandidateMs = Math.round(
        performance.now() - findCandidateStartedAt,
      );
      if (!prepared) return false;
      const contextStartedAt = performance.now();
      const context = await this.runner.loadSimulationRangeProcessingContext(
        prepared.simulation.platform,
        ranges,
      );
      const loadRangeContextMs = Math.round(
        performance.now() - contextStartedAt,
      );
      const task = await this.distributedEvaluator.enqueueLeadersForRange(
        prepared.simulation,
        prepared.candidateLeaders,
        range,
        context.contractById,
        { findCandidateMs, loadRangeContextMs },
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

  private async dispatchCompletedPlans(now: Date) {
    if (this.finalizerDispatchRunning) return;
    this.finalizerDispatchRunning = true;
    try {
      const workflow = await this.workflowConfig.get();
      const availableSlots = Math.max(
        0,
        workflow.finalizerConcurrency - this.activeFinalizerPlans.size,
      );
      if (!availableSlots) return;
      const plans = await this.prisma.simulationExecutionPlan.findMany({
        where: {
          OR: [
            {
              status: SimulationExecutionPlanStatus.Dispatched,
              evaluatorTask: {
                is: { status: SimulationEvaluatorTaskStatus.Completed },
              },
            },
            {
              status: SimulationExecutionPlanStatus.AwaitingEventLogs,
              nextFinalizationAt: { lte: now },
              evaluatorTask: {
                is: { status: SimulationEvaluatorTaskStatus.Completed },
              },
            },
          ],
          simulation: {
            is: {
              status: { not: SimulationStatus.Cancelled },
              research: { is: { status: { not: SimulationStatus.Cancelled } } },
              OR: [
                { automationLeaseToken: null },
                { automationLeaseExpiresAt: { lte: now } },
              ],
            },
          },
        },
        include: {
          evaluatorTask: true,
          simulation: { include: { research: true } },
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        // Scan beyond the concurrency limit so a run of old plans from one
        // simulation cannot hide ready work belonging to other simulations.
        take: Math.min(500, workflow.finalizerBatchSize * availableSlots),
      });
      for (const plan of plans) {
        if (this.activeFinalizerPlans.size >= workflow.finalizerConcurrency)
          break;
        if (
          this.activeFinalizerPlans.has(plan.id) ||
          this.activeFinalizerSimulations.has(plan.simulationId)
        )
          continue;
        this.activeFinalizerPlans.add(plan.id);
        this.activeFinalizerSimulations.add(plan.simulationId);
        void this.finalizePlan(plan, new Date(), workflow)
          .catch(() => undefined)
          .finally(() => {
            this.activeFinalizerPlans.delete(plan.id);
            this.activeFinalizerSimulations.delete(plan.simulationId);
            void this.dispatchCompletedPlans(new Date());
          });
      }
    } finally {
      this.finalizerDispatchRunning = false;
    }
  }

  private async finalizePlan(
    plan: any,
    now: Date,
    workflow: {
      finalizerLeaseMs: number;
      finalizerRetryDelayMs: number;
    },
  ) {
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + workflow.finalizerLeaseMs);
    const simulationClaim = await this.prisma.simulation.updateMany({
      where: {
        id: plan.simulationId,
        OR: [
          { automationLeaseToken: null },
          { automationLeaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        automationLeaseToken: leaseToken,
        automationLeaseExpiresAt: leaseExpiresAt,
      },
    });
    if (!simulationClaim.count) return;
    const claim = await this.prisma.simulationExecutionPlan.updateMany({
      where: {
        id: plan.id,
        status: {
          in: [
            SimulationExecutionPlanStatus.Dispatched,
            SimulationExecutionPlanStatus.AwaitingEventLogs,
          ],
        },
      },
      data: {
        status: SimulationExecutionPlanStatus.Finalizing,
        leaseToken,
        leaseExpiresAt,
        nextFinalizationAt: null,
      },
    });
    if (!claim.count) {
      await this.releaseSimulationFinalizerLease(plan.simulationId, leaseToken);
      return;
    }
    const renewal = setInterval(
      () =>
        void this.renewFinalizerLease(
          plan.id,
          plan.simulationId,
          leaseToken,
          workflow.finalizerLeaseMs,
        ),
      Math.max(10_000, Math.floor(workflow.finalizerLeaseMs / 3)),
    );
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
      const aggregationStartedAt = performance.now();
      const finalization = await this.runner.finalizeSimulationRange(
        plan.simulationId,
        range,
        context,
        evaluated,
      );
      if (finalization.awaitingEventLogs) {
        await this.prisma.simulationExecutionPlan.updateMany({
          where: { id: plan.id, leaseToken },
          data: {
            status: SimulationExecutionPlanStatus.AwaitingEventLogs,
            leaseToken: null,
            leaseExpiresAt: null,
            nextFinalizationAt: new Date(
              Date.now() + workflow.finalizerRetryDelayMs,
            ),
            lastError: null,
          },
        });
        return;
      }
      const aggregationMs = Math.round(
        performance.now() - aggregationStartedAt,
      );
      const result = this.withFinalizationTiming(
        plan.evaluatorTask.result,
        aggregationMs,
      );
      await this.prisma.simulationEvaluatorTask.update({
        where: { id: plan.evaluatorTask.id },
        data: {
          result,
          resultChecksum: this.checksum(result),
        },
      });
      await this.prisma.simulationExecutionPlan.updateMany({
        where: { id: plan.id, leaseToken },
        data: {
          status: SimulationExecutionPlanStatus.Completed,
          completedAt: new Date(),
          nextFinalizationAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      if (finalization.simulation?.status === SimulationStatus.Completed) {
        await this.logSimulationTiming(plan.simulationId);
      }
      await this.syncResearch(plan.simulation.researchId);
    } catch (error) {
      await this.prisma.simulationExecutionPlan.updateMany({
        where: { id: plan.id, leaseToken },
        data: {
          status: SimulationExecutionPlanStatus.Failed,
          attempts: { increment: 1 },
          leaseToken: null,
          leaseExpiresAt: null,
          nextFinalizationAt: null,
          lastError: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      clearInterval(renewal);
      await this.releaseSimulationFinalizerLease(plan.simulationId, leaseToken);
    }
  }

  private async renewFinalizerLease(
    planId: string,
    simulationId: number,
    leaseToken: string,
    leaseMs: number,
  ) {
    const leaseExpiresAt = new Date(Date.now() + leaseMs);
    await Promise.all([
      this.prisma.simulationExecutionPlan.updateMany({
        where: { id: planId, leaseToken },
        data: { leaseExpiresAt },
      }),
      this.prisma.simulation.updateMany({
        where: { id: simulationId, automationLeaseToken: leaseToken },
        data: { automationLeaseExpiresAt: leaseExpiresAt },
      }),
    ]);
  }

  private async releaseSimulationFinalizerLease(
    simulationId: number,
    leaseToken: string,
  ) {
    await this.prisma.simulation.updateMany({
      where: { id: simulationId, automationLeaseToken: leaseToken },
      data: { automationLeaseToken: null, automationLeaseExpiresAt: null },
    });
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
        this.prisma.simulationExecutionPlan.updateMany({
          where: {
            id: plan.id,
            status: SimulationExecutionPlanStatus.Dispatched,
          },
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
    // Simulation status is derived from the completed plan count.  Restore it
    // before aggregating the parent so an interrupted finalization cannot keep
    // either record in Running after all plan windows were written.
    const simulationsToComplete = await this.prisma.simulation.findMany({
      where: {
        researchId,
        status: {
          notIn: [
            SimulationStatus.Cancelled,
            SimulationStatus.Completed,
            SimulationStatus.Failed,
          ],
        },
      },
      select: {
        id: true,
        completedPlans: true,
        totalSimulationPlans: true,
      },
    });
    const recoveredSimulations = await Promise.all(
      simulationsToComplete
        .filter(
          (simulation) =>
            simulation.totalSimulationPlans > 0 &&
            simulation.completedPlans >= simulation.totalSimulationPlans,
        )
        .map((simulation) =>
          this.prisma.simulation.update({
            where: { id: simulation.id },
            data: {
              status: SimulationStatus.Completed,
              progressPhase: 'completed',
              progressMessage: 'Simulation result completed',
              progressPercent: 100,
            },
          }),
        ),
    );
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
                createdAt: true,
                dispatchedAt: true,
                completedAt: true,
                evaluatorTask: {
                  select: { status: true, input: true, result: true },
                },
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
        SimulationExecutionPlanStatus.AwaitingEventLogs,
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
        plan.status === SimulationExecutionPlanStatus.AwaitingEventLogs ||
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
    await Promise.all(
      recoveredSimulations.map((simulation) =>
        this.runner.emitSimulationUpdated(simulation),
      ),
    );
    const simulation = await this.prisma.simulation.findFirst({
      where: { researchId },
    });
    if (simulation) await this.runner.emitSimulationUpdated(simulation);
  }

  private rangeKey(startedAt: Date, endedAt: Date) {
    return `${startedAt.toISOString()}:${endedAt.toISOString()}`;
  }

  private withFinalizationTiming(result: unknown, aggregationMs: number) {
    const value = this.asRecord(result);
    return {
      ...value,
      finalizationTiming: { aggregationMs },
    };
  }

  private async logSimulationTiming(simulationId: number) {
    const simulation = await this.prisma.simulation.findUniqueOrThrow({
      where: { id: simulationId },
      include: {
        executionPlans: {
          where: { status: SimulationExecutionPlanStatus.Completed },
          include: {
            evaluatorTask: { select: { input: true, result: true } },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    const plans = simulation.executionPlans;
    const sums = {
      findCandidate: 0,
      loadRangeContext: 0,
      leaderEvaluation: 0,
      botCacheAndAggregation: 0,
      cacheRead: 0,
      recentFilter: 0,
      historyConversion: 0,
      positionBuild: 0,
      scoring: 0,
    };
    for (const plan of plans) {
      const input = this.asRecord(plan.evaluatorTask?.input);
      const result = this.asRecord(plan.evaluatorTask?.result);
      const dispatchTiming = this.asRecord(input.dispatchTiming);
      const workerTiming = this.asRecord(result.timing);
      const finalizationTiming = this.asRecord(result.finalizationTiming);
      sums.findCandidate += this.numberValue(dispatchTiming.findCandidateMs);
      sums.loadRangeContext += this.numberValue(
        dispatchTiming.loadRangeContextMs,
      );
      sums.leaderEvaluation += this.numberValue(workerTiming.totalMs);
      sums.botCacheAndAggregation += this.numberValue(
        finalizationTiming.aggregationMs,
      );
      sums.cacheRead += this.numberValue(workerTiming.cacheReadMs);
      sums.recentFilter += this.numberValue(workerTiming.recentFilterMs);
      sums.historyConversion += this.numberValue(
        workerTiming.historyConversionMs,
      );
      sums.positionBuild += this.numberValue(workerTiming.positionBuildMs);
      sums.scoring += this.numberValue(workerTiming.scoringMs);
    }
    const startedAt = plans[0]?.createdAt;
    const finishedAt = plans.at(-1)?.completedAt ?? new Date();
    await this.logger.log({
      severity: 'Debug',
      summary: 'analytics.simulation.performance.completed',
      details: JSON.stringify({
        researchId: simulation.researchId,
        simulationId: simulation.id,
        title: simulation.title,
        completedPlanCount: plans.length,
        totalExecutionMs: startedAt
          ? Math.max(0, finishedAt.getTime() - startedAt.getTime())
          : null,
        summedPlanTimingsMs: sums,
      }),
    });
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private numberValue(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }

  private checksum(value: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}

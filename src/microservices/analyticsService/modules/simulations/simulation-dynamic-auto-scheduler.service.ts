import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import {
  SimulationEvaluatorTaskKind,
  SimulationEvaluatorTaskStatus,
  SimulationExecutionPlanStatus,
  SimulationStatus,
} from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { SimulationWorkflowConfigService } from 'src/global/simulation-workflow-config.service';
import { SimulationEvaluatorTaskService } from '../simulationEvaluator/simulation-evaluator-task.service';
import { SIMULATION_EVALUATOR } from '../simulationEvaluator/simulation-evaluator.constants';
import { DistributedSimulationEvaluatorService } from './distributed-simulation-evaluator.service';
import { SimulationAutoRunnerService } from './simulation-auto-runner.service';
import { getEventLogOrderBy } from 'src/microservices/apiService/modules/trade-histories/event-log-identity.utils';
import { buildAutomationHorizon } from './utils/simulation-automation-queue.utils';
import {
  buildSimulationRanges,
  WindowRange,
} from './utils/simulation-range.utils';

type DispatchCandidate = {
  simulation: any;
  ranges: WindowRange[];
  undispatchedRanges: WindowRange[];
};

const SOURCE_DERIVED_MATERIALIZATION_TRANSACTION_OPTIONS = {
  maxWait: 10_000,
  timeout: 10 * 60_000,
} as const;

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
  // At exactly 2× capacity, refill to 3×. The pause applies only once the
  // current queue is *larger* than the low watermark.
  if (availableTasks > lowWatermark) return 0;

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
  private readonly activeSourceDerivedSimulations = new Set<number>();
  // A materializer normally persists its plan lease in the same database
  // transaction as the simulation lease.  Retain a short grace period for a
  // live claim, then recover any lease that has no matching finalizing plan.
  private readonly orphanedMaterializerLeaseGraceMs = 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly runner: SimulationAutoRunnerService,
    private readonly distributedEvaluator: DistributedSimulationEvaluatorService,
    private readonly evaluatorTasks: SimulationEvaluatorTaskService,
    private readonly logger: LogsService,
    private readonly workflowConfig: SimulationWorkflowConfigService,
  ) {}

  async processAvailableSimulations(now = new Date()) {
    await this.registerLeaderEvaluationTasks(now);
    await this.handleResolvedEvaluationTasks(now);
    await this.finalizeMaterializedSimulations(now);
  }

  /**
   * Layer 1: keep the evaluator fleet fed from the oldest unfinished
   * simulation.  This is intentionally not fair: completing the oldest
   * research before moving on prevents short and long simulations from making
   * indistinguishable percentage progress.
   */
  async registerLeaderEvaluationTasks(now = new Date()) {
    await this.reconcileInterruptedPlans(now);
    await this.fillEvaluatorQueue(now);
    // A shutdown can happen after finalizeSimulationRange has persisted the
    // simulation result but before this service has marked the execution plan
    // complete and refreshed the research counters.  Do not make convergence
    // depend on there being another range to dispatch: a fully dispatched
    // research has no candidates, which used to leave that stale state forever.
    await this.reconcileResearchProgress();
  }

  /** Layer 2: turn completed evaluator results into plans and bots only. */
  async handleResolvedEvaluationTasks(now = new Date()) {
    await this.reconcileInterruptedPlans(now);
    await this.dispatchCompletedPlans(now);
    await this.materializeSourceDerivedSimulation(now);
  }

  private async materializeSourceDerivedSimulation(now: Date) {
    const target = await this.prisma.simulation.findFirst({
      where: {
        sourceSimulationId: { not: null },
        status: SimulationStatus.Running,
        simulationPlans: { none: {} },
        research: {
          is: {
            automationEnabled: true,
            status: {
              notIn: [
                SimulationStatus.Cancelled,
                SimulationStatus.Completed,
                SimulationStatus.Failed,
              ],
            },
          },
        },
      },
      include: {
        sourceSimulation: {
          include: {
            simulationPlans: {
              orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
              include: {
                simulationBots: {
                  orderBy: { id: 'asc' },
                  include: {
                    cache: {
                      include: { eventLogs: { orderBy: getEventLogOrderBy() } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!target?.sourceSimulation) return;
    const leaseToken = randomUUID();
    const claimed = await this.prisma.simulation.updateMany({
      where: {
        id: target.id,
        OR: [
          { automationLeaseToken: null },
          { automationLeaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        automationLeaseToken: leaseToken,
        automationLeaseExpiresAt: new Date(now.getTime() + 30 * 60_000),
        progressPhase: 'materializing-layer-2-variants',
        progressMessage: 'Copying plans and bots from the Layer 1 source',
      },
    });
    if (!claimed.count) return;
    const ranges = (value: unknown) =>
      Array.isArray(value)
        ? (value as Array<{ min: number; max: number }>)
        : [];
    const serializeRanges = (value: unknown): Prisma.InputJsonArray =>
      ranges(value).map(({ min, max }) => ({ min, max }));
    const collateral = ranges(target.leaderExecutionCollateral);
    const size = ranges(target.leaderExecutionSize);
    const leverage = ranges(target.leaderExecutionLeverage);
    try {
      await this.prisma.$transaction(async (tx) => {
        for (const sourcePlan of target.sourceSimulation!.simulationPlans) {
          const plan = await tx.simulationPlan.create({
            data: {
              title: `${target.title} ${sourcePlan.startAt.toISOString().slice(0, 10)}`,
              description: target.description,
              startAt: sourcePlan.startAt,
              endAt: sourcePlan.endAt,
              cursor: sourcePlan.cursor,
              simulationId: target.id,
              sourceSimulationPlanId: sourcePlan.id,
            },
          });
          const derivedBots = await tx.simulationBot.createManyAndReturn({
            data: sourcePlan.simulationBots.map((bot) => ({
              sourceSimulationBotId: bot.id,
              leaderAddress: bot.leaderAddress,
              leaderPlatform: bot.leaderPlatform,
              simulationPlanId: plan.id,
              startedAt: bot.startedAt,
              stoppedAt: bot.stoppedAt,
              mode: bot.mode,
              ratio: bot.ratio,
              score: bot.score,
              minCollateral: Math.min(...collateral.map((item) => item.min)),
              maxCollateral: Math.max(...collateral.map((item) => item.max)),
              minSize: Math.min(...size.map((item) => item.min)),
              maxSize: Math.max(...size.map((item) => item.max)),
              minLeverage: Math.min(...leverage.map((item) => item.min)),
              maxLeverage: Math.max(...leverage.map((item) => item.max)),
              leaderExecutionCollateral: serializeRanges(
                target.leaderExecutionCollateral,
              ),
              leaderExecutionSize: serializeRanges(target.leaderExecutionSize),
              leaderExecutionLeverage: serializeRanges(
                target.leaderExecutionLeverage,
              ),
              followerRiskSize: serializeRanges(target.followerRiskSize),
              followerRiskCollateral: serializeRanges(
                target.followerRiskCollateral,
              ),
              evaluationTradeCount: bot.evaluationTradeCount,
              evaluationSlope: bot.evaluationSlope,
              evaluationR2: bot.evaluationR2,
              evaluationCopiedPnlUsd: bot.evaluationCopiedPnlUsd,
              evaluationProfitFactor: bot.evaluationProfitFactor,
              evaluationMaxDrawdownUsd: bot.evaluationMaxDrawdownUsd,
            })),
            select: { id: true, sourceSimulationBotId: true },
          });
          const sourceBotById = new Map(
            sourcePlan.simulationBots.map((bot) => [bot.id, bot]),
          );
          const copiedCaches = await tx.simulationBotCache.createManyAndReturn({
            data: derivedBots.map((bot) => {
              const sourceCache = sourceBotById.get(
                bot.sourceSimulationBotId!,
              )?.cache;
              if (
                !sourceCache?.snapshotCapturedAt ||
                sourceCache.eventSnapshotVersion < 2
              ) {
                throw new Error(
                  `Source snapshot is unavailable for simulation bot ${bot.sourceSimulationBotId}`,
                );
              }
              return {
                simulationBotId: bot.id,
                completed: sourceCache.completed,
                eventSnapshotVersion: sourceCache.eventSnapshotVersion,
                snapshotCapturedAt: sourceCache.snapshotCapturedAt,
              };
            }),
            select: { id: true, simulationBotId: true },
          });
          const copiedCacheIdByBotId = new Map(
            copiedCaches.map((cache) => [cache.simulationBotId, cache.id]),
          );
          const copiedEventLogs = derivedBots.flatMap((bot) => {
            const sourceCache = sourceBotById.get(
              bot.sourceSimulationBotId!,
            )!.cache!;
            const simulationBotCacheId = copiedCacheIdByBotId.get(bot.id)!;
            return sourceCache.eventLogs.map((eventLog) => ({
              simulationBotCacheId,
              sourceEventLogKey: eventLog.sourceEventLogKey,
              contractId: eventLog.contractId,
              address: eventLog.address,
              platform: eventLog.platform,
              block: eventLog.block,
              logIndex: eventLog.logIndex,
              transactionHash: eventLog.transactionHash,
              date: eventLog.date,
              jsonLog: eventLog.jsonLog,
              usdPnl: eventLog.usdPnl,
            }));
          });
          if (copiedEventLogs.length) {
            await tx.simulationBotCachedEventLog.createMany({
              data: copiedEventLogs,
            });
          }
        }
      }, SOURCE_DERIVED_MATERIALIZATION_TRANSACTION_OPTIONS);
      await this.prisma.simulation.update({
        where: { id: target.id, automationLeaseToken: leaseToken },
        data: {
          automationLeaseToken: null,
          automationLeaseExpiresAt: null,
          progressPhase: 'layer-2-variants-materialized',
          progressMessage: 'Waiting for Layer 3 source-snapshot calculation',
        },
      });
    } catch (error) {
      await this.prisma.simulation.update({
        where: { id: target.id, automationLeaseToken: leaseToken },
        data: {
          automationLeaseToken: null,
          automationLeaseExpiresAt: null,
          status: SimulationStatus.Failed,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (target.researchId !== null)
        await this.syncResearch(target.researchId);
    }
  }

  /** Layer 3: process a fully materialized simulation in chronological order. */
  async finalizeMaterializedSimulations(now = new Date()) {
    // Source-derived simulations reuse a completed Layer 1 snapshot and do
    // not consume evaluator capacity.  Give this short path a guaranteed turn
    // before launching the slower, ordinary finalizers so sustained Layer 1
    // traffic cannot starve Layer 2/3 research indefinitely.
    const workflow = await this.workflowConfig.get();
    await this.startSourceDerivedSimulation(
      now,
      Math.max(30_000, workflow.finalizerLeaseMs ?? 30 * 60_000),
    );
    const availableSlots = Math.max(
      0,
      workflow.finalizerConcurrency - this.activeFinalizerSimulations.size,
    );
    if (availableSlots) {
      const candidates = await this.prisma.simulation.findMany({
        where: {
          sourceSimulationId: null,
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
          executionPlans: {
            some: { status: SimulationExecutionPlanStatus.AwaitingEventLogs },
          },
          OR: [
            { automationLeaseToken: null },
            { automationLeaseExpiresAt: { lte: now } },
          ],
        },
        include: {
          executionPlans: { select: { id: true, status: true } },
          research: true,
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: Math.max(50, availableSlots * 4),
      });

      const readyCandidates = candidates
        .filter(
          (simulation) =>
            simulation.totalSimulationPlans > 0 &&
            simulation.executionPlans.length ===
              simulation.totalSimulationPlans &&
            simulation.executionPlans.every(
              (plan) =>
                plan.status === SimulationExecutionPlanStatus.AwaitingEventLogs,
            ) &&
            !this.activeFinalizerSimulations.has(simulation.id),
        )
        .slice(0, availableSlots);

      await Promise.all(
        readyCandidates.map(async (candidate) => {
          const leaseToken = randomUUID();
          const claimed = await this.prisma.simulation.updateMany({
            where: {
              id: candidate.id,
              OR: [
                { automationLeaseToken: null },
                { automationLeaseExpiresAt: { lte: now } },
              ],
            },
            data: {
              automationLeaseToken: leaseToken,
              automationLeaseExpiresAt: new Date(now.getTime() + 30 * 60_000),
              progressPhase: 'building-layer-2-3-caches',
              progressMessage: 'Building plan caches in chronological order',
            },
          });
          if (!claimed.count) return;
          this.activeFinalizerSimulations.add(candidate.id);
          void this.finalizeClaimedSimulation(candidate, leaseToken);
        }),
      );
      if (readyCandidates.length) return;
    }
  }

  private async finalizeClaimedSimulation(candidate: any, leaseToken: string) {
    try {
      const finalization = await this.runner.finalizeMaterializedSimulation(
        candidate.id,
      );
      if (finalization.awaitingEventLogs) return;
      await this.prisma.simulationExecutionPlan.updateMany({
        where: {
          simulationId: candidate.id,
          status: SimulationExecutionPlanStatus.AwaitingEventLogs,
        },
        data: {
          status: SimulationExecutionPlanStatus.Completed,
          completedAt: new Date(),
        },
      });
      if (candidate.researchId !== null) {
        await this.syncResearch(candidate.researchId);
      }
      await this.logSimulationTiming(candidate.id);
    } catch (error) {
      await this.prisma.simulation.update({
        where: { id: candidate.id },
        data: {
          status: SimulationStatus.Failed,
          progressPhase: 'layer-3-cache-failed',
          progressMessage: 'Layer 3 cache construction failed',
          error: error instanceof Error ? error.message : String(error),
        },
      });
    } finally {
      this.activeFinalizerSimulations.delete(candidate.id);
      await this.releaseSimulationFinalizerLease(candidate.id, leaseToken);
    }
  }

  private async startSourceDerivedSimulation(now: Date, leaseMs: number) {
    if (this.activeSourceDerivedSimulations.size > 0) return;
    const candidate = await this.prisma.simulation.findFirst({
      where: {
        sourceSimulationId: { not: null },
        sourceSimulation: {
          is: { status: SimulationStatus.Completed },
        },
        research: {
          is: {
            automationEnabled: true,
            status: {
              notIn: [SimulationStatus.Cancelled, SimulationStatus.Completed],
            },
          },
        },
        status: SimulationStatus.Running,
        simulationPlans: { some: {} },
        OR: [
          { automationLeaseToken: null },
          { automationLeaseExpiresAt: { lte: now } },
        ],
      },
      include: {
        research: true,
        _count: { select: { simulationPlans: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (
      !candidate ||
      this.activeSourceDerivedSimulations.has(candidate.id) ||
      candidate._count.simulationPlans !== candidate.totalSimulationPlans
    )
      return;
    const leaseToken = randomUUID();
    const claimed = await this.prisma.simulation.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { automationLeaseToken: null },
          { automationLeaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        automationLeaseToken: leaseToken,
        automationLeaseExpiresAt: new Date(now.getTime() + leaseMs),
        progressPhase: 'recalculating-layer-2-3',
        progressMessage: 'Recalculating from Layer 1 source snapshots',
      },
    });
    if (!claimed.count) return;
    this.activeSourceDerivedSimulations.add(candidate.id);
    void this.finalizeClaimedSourceDerivedSimulation(
      candidate,
      leaseToken,
      leaseMs,
    );
  }

  private async finalizeClaimedSourceDerivedSimulation(
    candidate: { id: number; researchId: number | null },
    leaseToken: string,
    leaseMs: number,
  ) {
    const renewal = setInterval(
      () =>
        void this.renewSimulationFinalizerLease(
          candidate.id,
          leaseToken,
          leaseMs,
        ),
      Math.max(10_000, Math.floor(leaseMs / 3)),
    );
    try {
      await this.runner.finalizeSourceDerivedSimulation(candidate.id);
      if (candidate.researchId !== null)
        await this.syncResearch(candidate.researchId);
    } catch (error) {
      await this.prisma.simulation.update({
        where: { id: candidate.id },
        data: {
          status: SimulationStatus.Failed,
          progressPhase: 'source-snapshot-finalization-failed',
          progressMessage: 'Source-snapshot finalization failed',
          error: error instanceof Error ? error.message : String(error),
        },
      });
      if (candidate.researchId !== null)
        await this.syncResearch(candidate.researchId);
    } finally {
      clearInterval(renewal);
      this.activeSourceDerivedSimulations.delete(candidate.id);
      await this.releaseSimulationFinalizerLease(candidate.id, leaseToken);
    }
  }

  private async renewSimulationFinalizerLease(
    simulationId: number,
    leaseToken: string,
    leaseMs: number,
  ) {
    await this.prisma.simulation.updateMany({
      where: { id: simulationId, automationLeaseToken: leaseToken },
      data: { automationLeaseExpiresAt: new Date(Date.now() + leaseMs) },
    });
  }

  private async reconcileResearchProgress() {
    const researchIds = await this.prisma.simulationResearch.findMany({
      where: {
        automationEnabled: true,
        status: {
          notIn: [SimulationStatus.Cancelled, SimulationStatus.Failed],
        },
        OR: [
          { status: { not: SimulationStatus.Completed } },
          {
            simulations: {
              some: {
                executionPlans: {
                  some: {
                    status: { not: SimulationExecutionPlanStatus.Completed },
                  },
                },
              },
            },
          },
          {
            sourceSimulationId: { not: null },
            status: SimulationStatus.Completed,
            totalPlans: { gt: 0 },
            finalizedPlans: 0,
          },
        ],
      },
      select: { id: true },
    });

    await Promise.all(researchIds.map(({ id }) => this.syncResearch(id)));
  }

  private async fillEvaluatorQueue(now: Date) {
    const simulations = await this.prisma.simulation.findMany({
      where: {
        sourceSimulationId: null,
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
      // Oldest research wins. `updatedAt` is deliberately not used here: it
      // continually changes while work is dispatched and would otherwise make
      // newer, smaller simulations compete with an older one.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
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
        return undispatchedRanges.length
          ? [
              {
                simulation,
                ranges,
                undispatchedRanges,
              },
            ]
          : [];
      },
    );
    if (!candidates.length) return;

    // A simulation with no currently-dispatchable ranges must not block every
    // later research.  This used to return here when the oldest simulation was
    // waiting for its already-dispatched work to finish; after a restart or an
    // interrupted finalization that could leave all newer, ready researches at
    // "Running" with zero execution plans indefinitely.
    //
    // Keep the ordering deterministic by selecting the oldest *dispatchable*
    // simulation rather than the oldest unfinished simulation.
    const oldest = candidates[0];
    const workerCapacity = await this.evaluatorTasks.countReadyWorkers(
      oldest.simulation.platform,
      oldest.simulation.startAt,
      oldest.simulation.endAt,
      true,
    );
    const workflow = await this.workflowConfig.get();
    const outstanding = await this.prisma.simulationExecutionPlan.count({
      where: {
        status: {
          in: [
            SimulationExecutionPlanStatus.Pending,
            SimulationExecutionPlanStatus.Dispatched,
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
              status: SimulationExecutionPlanStatus.Finalizing,
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

    while (deficit > 0 && oldest.undispatchedRanges.length > 0) {
      const range = oldest.undispatchedRanges.shift()!;
      const dispatched = await this.dispatchPlan(
        oldest.simulation,
        range,
        oldest.ranges,
      );
      if (dispatched) {
        deficit -= 1;
      }
    }
    await this.syncResearch(oldest.simulation.researchId);
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
      const commonWhere = {
        evaluatorTask: {
          is: { status: SimulationEvaluatorTaskStatus.Completed },
        },
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
      };
      // We allow only one plan from a simulation at a time to preserve its
      // ordered aggregation.  A small, fixed scan can therefore leave slots
      // idle when its oldest rows belong to the same simulation.  Scan the
      // enough of the bounded finalizer backlog so another simulation can use
      // the spare slot.  Keep finalizerBatchSize meaningful as the minimum
      // scan requested by an operator.
      const scanLimit = Math.min(
        500,
        Math.max(
          workflow.finalizerBatchSize * availableSlots,
          workflow.finalizerConcurrency * 100,
        ),
      );
      const queryOptions = {
        include: {
          evaluatorTask: true,
          simulation: { include: { research: true } },
        },
        orderBy: [{ updatedAt: 'asc' as const }, { id: 'asc' as const }],
        take: scanLimit,
      };
      const plans = await this.prisma.simulationExecutionPlan.findMany({
        ...queryOptions,
        where: {
          ...commonWhere,
          status: SimulationExecutionPlanStatus.Dispatched,
        },
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
        void this.materializePlan(plan, new Date(), workflow)
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

  private async materializePlan(
    plan: any,
    now: Date,
    workflow: {
      finalizerLeaseMs: number;
      finalizerRetryDelayMs: number;
      finalizerBotCacheConcurrency: number;
    },
  ) {
    const totalStartedAt = performance.now();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + workflow.finalizerLeaseMs);
    const claimStartedAt = performance.now();
    // Commit both lease records together.  Previously a process could stop
    // between these writes, leaving a simulation lease with no plan owner and
    // blocking the finalizer for the entire lease duration.
    const claimed = await this.prisma.$transaction(async (tx) => {
      const simulationClaim = await tx.simulation.updateMany({
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
      if (!simulationClaim.count) return false;
      const planClaim = await tx.simulationExecutionPlan.updateMany({
        where: {
          id: plan.id,
          status: {
            in: [SimulationExecutionPlanStatus.Dispatched],
          },
        },
        data: {
          status: SimulationExecutionPlanStatus.Finalizing,
          leaseToken,
          leaseExpiresAt,
          nextFinalizationAt: null,
        },
      });
      if (planClaim.count) return true;
      await tx.simulation.updateMany({
        where: { id: plan.simulationId, automationLeaseToken: leaseToken },
        data: { automationLeaseToken: null, automationLeaseExpiresAt: null },
      });
      return false;
    });
    if (!claimed) return;
    const claimMs = Math.round(performance.now() - claimStartedAt);
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
      const contextStartedAt = performance.now();
      const context = await this.runner.loadSimulationRangeProcessingContext(
        plan.simulation.platform,
        ranges,
      );
      const loadRangeContextMs = Math.round(
        performance.now() - contextStartedAt,
      );
      const taskInput = plan.evaluatorTask.input as {
        candidateLeaders?: string[];
      };
      const readEvaluationStartedAt = performance.now();
      const evaluated = this.distributedEvaluator.readCompletedEvaluation(
        plan.evaluatorTask.result,
        plan.evaluatorTask.id,
        taskInput.candidateLeaders ?? [],
      );
      const readEvaluationMs = Math.round(
        performance.now() - readEvaluationStartedAt,
      );
      const runnerStartedAt = performance.now();
      const finalization = await this.runner.materializeSimulationRange(
        plan.simulationId,
        range,
        context,
        evaluated,
      );
      const runnerMs = Math.round(performance.now() - runnerStartedAt);
      const result = this.withFinalizationTiming(plan.evaluatorTask.result, {
        queueWaitMs: Math.max(
          0,
          now.getTime() - plan.evaluatorTask.updatedAt.getTime(),
        ),
        claimMs,
        loadRangeContextMs,
        readEvaluationMs,
        runnerMs,
        ...(finalization.timing ?? {}),
      });
      const persistenceStartedAt = performance.now();
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
          status: SimulationExecutionPlanStatus.AwaitingEventLogs,
          nextFinalizationAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      await this.syncResearch(plan.simulation.researchId);
      await this.logger.log({
        severity: 'Debug',
        summary: 'analytics.simulation.performance.finalizer',
        details: JSON.stringify({
          researchId: plan.simulation.researchId,
          simulationId: plan.simulationId,
          planId: plan.id,
          finalizationTiming: {
            claimMs,
            loadRangeContextMs,
            readEvaluationMs,
            runnerMs,
            persistenceMs: Math.round(performance.now() - persistenceStartedAt),
            totalMs: Math.round(performance.now() - totalStartedAt),
            ...(finalization.timing ?? {}),
          },
        }),
      });
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

    const orphanedMaterializerLeases = await this.prisma.simulation.updateMany({
      where: {
        sourceSimulationId: null,
        automationLeaseToken: { not: null },
        automationLeaseExpiresAt: { gt: now },
        updatedAt: {
          lte: new Date(now.getTime() - this.orphanedMaterializerLeaseGraceMs),
        },
        executionPlans: {
          some: {
            status: SimulationExecutionPlanStatus.Dispatched,
            evaluatorTask: {
              is: { status: SimulationEvaluatorTaskStatus.Completed },
            },
          },
          none: { status: SimulationExecutionPlanStatus.Finalizing },
        },
      },
      data: {
        automationLeaseToken: null,
        automationLeaseExpiresAt: null,
      },
    });
    if (orphanedMaterializerLeases.count) {
      await this.logger.log({
        severity: 'Warning',
        summary: 'analytics.simulation.recoveredOrphanedMaterializerLeases',
        details: JSON.stringify({
          count: orphanedMaterializerLeases.count,
          graceMs: this.orphanedMaterializerLeaseGraceMs,
        }),
      });
    }
  }

  private async syncResearch(researchId: number) {
    // Restore a simulation only after its execution plans have actually
    // completed.  Layer 2 writes SimulationPlan rows before Layer 3 processes
    // their event logs and builds bot caches, so plan-row count alone is not a
    // completion signal.
    const simulationsToComplete = await this.prisma.simulation.findMany({
      where: {
        researchId,
        status: {
          notIn: [SimulationStatus.Cancelled, SimulationStatus.Failed],
        },
      },
      select: {
        id: true,
        status: true,
        completedPlans: true,
        totalSimulationPlans: true,
        executionPlans: { select: { status: true } },
      },
    });
    const resumedSimulations = await Promise.all(
      simulationsToComplete
        .filter(
          (simulation) =>
            simulation.status === SimulationStatus.Completed &&
            simulation.totalSimulationPlans > 0 &&
            simulation.executionPlans.some(
              (plan) => plan.status !== SimulationExecutionPlanStatus.Completed,
            ),
        )
        .map((simulation) =>
          this.prisma.simulation.update({
            where: { id: simulation.id },
            data: {
              completedPlans: simulation.executionPlans.filter(
                (plan) =>
                  plan.status === SimulationExecutionPlanStatus.Completed,
              ).length,
              status: SimulationStatus.Running,
              progressPhase: 'awaiting-event-logs',
              progressMessage:
                'Waiting for plan event logs and cache completion',
              progressPercent:
                (simulation.executionPlans.filter(
                  (plan) =>
                    plan.status === SimulationExecutionPlanStatus.Completed,
                ).length /
                  simulation.totalSimulationPlans) *
                100,
            },
          }),
        ),
    );
    const recoveredSimulations = await Promise.all(
      simulationsToComplete
        .filter(
          (simulation) =>
            simulation.status !== SimulationStatus.Completed &&
            simulation.totalSimulationPlans > 0 &&
            simulation.executionPlans.length >=
              simulation.totalSimulationPlans &&
            simulation.executionPlans.every(
              (plan) => plan.status === SimulationExecutionPlanStatus.Completed,
            ),
        )
        .map((simulation) =>
          this.prisma.simulation.update({
            where: { id: simulation.id },
            data: {
              completedPlans: simulation.totalSimulationPlans,
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
            status: true,
            error: true,
            totalSimulationPlans: true,
            completedPlans: true,
            _count: { select: { simulationPlans: true } },
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

    if (research.sourceSimulationId != null) {
      if (
        research.status === SimulationStatus.Cancelled ||
        research.status === SimulationStatus.Paused
      )
        return;
      const totalPlans = research.simulations.reduce(
        (sum, simulation) => sum + simulation.totalSimulationPlans,
        0,
      );
      const materializedPlans = research.simulations.reduce(
        (sum, simulation) => sum + simulation._count.simulationPlans,
        0,
      );
      const finalizedPlans = research.simulations.reduce(
        (sum, simulation) => sum + simulation.completedPlans,
        0,
      );
      const completed =
        totalPlans === 0 ||
        research.simulations.every(
          (simulation) => simulation.status === SimulationStatus.Completed,
        );
      const failedSimulation = research.simulations.find(
        (simulation) => simulation.status === SimulationStatus.Failed,
      );
      const materialized = Math.min(materializedPlans, totalPlans);
      const finalized = Math.min(finalizedPlans, totalPlans);

      await this.prisma.simulationResearch.update({
        where: { id: researchId },
        data: {
          status: failedSimulation
            ? SimulationStatus.Failed
            : completed
              ? SimulationStatus.Completed
              : SimulationStatus.Running,
          totalPlans,
          completedPlans: finalized,
          // This is a deliberate semantic mapping: the source simulation's
          // completed Layer 1 snapshots satisfy the evaluator milestone.
          evaluatedPlans: totalPlans,
          materializedPlans: materialized,
          finalizedPlans: finalized,
          outstandingPlans: Math.max(0, totalPlans - finalized),
          queuedPlans: Math.max(0, totalPlans - materialized),
          runningPlans: Math.max(0, materialized - finalized),
          finalizingPlans: Math.max(0, materialized - finalized),
          awaitingEventPlans: 0,
          progressPercent: totalPlans ? (finalized / totalPlans) * 100 : 100,
          progressPhase: failedSimulation
            ? 'source-derived-failed'
            : completed
              ? 'completed'
              : materialized < totalPlans
                ? 'materializing-layer-2-variants'
                : 'recalculating-layer-2-3',
          progressMessage: failedSimulation
            ? 'Source-derived simulation failed'
            : completed
              ? 'Layer 2/3 variant recalculation completed'
              : materialized < totalPlans
                ? `${materialized} / ${totalPlans} Layer 2 plan variants materialized`
                : `${finalized} / ${totalPlans} Layer 3 variant plans recalculated`,
          lastError: failedSimulation?.error ?? null,
          ...(completed ? { finishedAt: new Date() } : {}),
        },
      });
      return;
    }

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
    const evaluatedPlans = executionPlans.filter(
      (plan) =>
        plan.status === SimulationExecutionPlanStatus.AwaitingEventLogs ||
        plan.status === SimulationExecutionPlanStatus.Finalizing ||
        plan.status === SimulationExecutionPlanStatus.Completed ||
        (plan.status === SimulationExecutionPlanStatus.Dispatched &&
          plan.evaluatorTask?.status ===
            SimulationEvaluatorTaskStatus.Completed),
    ).length;
    const materializedPlans = executionPlans.filter(
      (plan) =>
        plan.status === SimulationExecutionPlanStatus.AwaitingEventLogs ||
        plan.status === SimulationExecutionPlanStatus.Completed,
    ).length;
    const awaitingEventPlans = executionPlans.filter(
      (plan) => plan.status === SimulationExecutionPlanStatus.AwaitingEventLogs,
    ).length;
    const finalizedPlans = executionPlans.filter(
      (plan) => plan.status === SimulationExecutionPlanStatus.Completed,
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
        evaluatedPlans,
        materializedPlans,
        awaitingEventPlans,
        finalizedPlans,
        progressPercent: totalPlans ? (completedPlans / totalPlans) * 100 : 100,
        progressPhase: completed ? 'completed' : 'dynamic-plan-scheduling',
        progressMessage: completed
          ? 'All simulation plan windows completed'
          : `${completedPlans} / ${totalPlans} simulation plans completed`,
        ...(completed ? { finishedAt: new Date() } : {}),
      },
    });
    await Promise.all(
      [...resumedSimulations, ...recoveredSimulations].map((simulation) =>
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

  private withFinalizationTiming(
    result: unknown,
    finalizationTiming: Record<string, number>,
  ) {
    const value = this.asRecord(result);
    return {
      ...value,
      finalizationTiming,
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
      createPlan: 0,
      botCache: 0,
      createBots: 0,
      ensureBotCaches: 0,
      planCache: 0,
      aggregation: 0,
      finalizerQueueWait: 0,
      finalizerClaim: 0,
      finalizerLoadRangeContext: 0,
      finalizerReadEvaluation: 0,
      finalizerPersistence: 0,
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
      // Retain the old field for dashboards while exposing each finalizer
      // phase separately.  Older task results only contain aggregationMs.
      sums.botCacheAndAggregation += this.numberValue(
        finalizationTiming.totalMs ?? finalizationTiming.aggregationMs,
      );
      sums.createPlan += this.numberValue(finalizationTiming.createPlanMs);
      sums.botCache += this.numberValue(finalizationTiming.botCacheMs);
      sums.createBots += this.numberValue(finalizationTiming.createBotsMs);
      sums.ensureBotCaches += this.numberValue(
        finalizationTiming.ensureBotCachesMs,
      );
      sums.planCache += this.numberValue(finalizationTiming.planCacheMs);
      sums.aggregation += this.numberValue(finalizationTiming.aggregationMs);
      sums.finalizerQueueWait += this.numberValue(
        finalizationTiming.queueWaitMs,
      );
      sums.finalizerClaim += this.numberValue(finalizationTiming.claimMs);
      sums.finalizerLoadRangeContext += this.numberValue(
        finalizationTiming.loadRangeContextMs,
      );
      sums.finalizerReadEvaluation += this.numberValue(
        finalizationTiming.readEvaluationMs,
      );
      sums.finalizerPersistence += this.numberValue(
        finalizationTiming.persistenceMs,
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

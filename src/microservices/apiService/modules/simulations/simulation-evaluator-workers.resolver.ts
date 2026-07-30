import { UseGuards } from '@nestjs/common';
import { Args, Int, Query, Mutation, Resolver } from '@nestjs/graphql';
import {
  Platform,
  SimulationStatus,
  UserPermission,
} from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { SimulationEvaluatorTaskService } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator-task.service';
import {
  SimulationEvaluatorTaskKind,
  SimulationEvaluatorTaskStatus,
  SimulationEvaluatorWorkerAuthorizationStatus,
  SimulationEvaluatorWorkerDesiredState,
  SimulationEvaluatorWorkerPlatformCacheStatus,
  SimulationEvaluatorWorkerRuntimeStatus,
  SimulationExecutionPlanStatus,
} from 'generated/prisma/enums';
import { SimulationWorkflowConfigService } from 'src/global/simulation-workflow-config.service';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';
import { missingRanges } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator-coverage';
import { GqlAuthGuard } from '../auth/gql-auth.guard';
import { RolesGuard } from '../auth/gql-role.guard';
import { Roles } from '../auth/roles.decorator';
import { SimulationEvaluatorWorkerAuthService } from './simulation-evaluator-worker-auth.service';
import {
  SimulationEvaluatorWorkerTaskView,
  SimulationEvaluatorWorkerTaskConnection,
  SimulationEvaluatorWorkerView,
  SimulationEvaluatorPipelineView,
} from './entities/simulations.entity';

const EVALUATOR_WORKER_RELEASE_URL = (version: string) =>
  `https://github.com/takeshi-su57/lucky-plan-be/releases/download/worker-v${encodeURIComponent(version)}/lucky-evaluator-worker-node25.zip`;

const isReleaseVersion = (value: string) =>
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
const isNewerReleaseVersion = (target: string, current: string) => {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
    return match
      ? {
          numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
          prerelease: match[4] || '',
        }
      : null;
  };
  const next = parse(target);
  const installed = parse(current);
  if (!next || !installed) return false;
  for (let index = 0; index < next.numbers.length; index += 1) {
    if (next.numbers[index] !== installed.numbers[index])
      return next.numbers[index]! > installed.numbers[index]!;
  }
  return !next.prerelease && Boolean(installed.prerelease);
};

@Resolver()
export class SimulationEvaluatorWorkersResolver {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: SimulationEvaluatorWorkerAuthService,
    private readonly tasks: SimulationEvaluatorTaskService,
    private readonly workflowConfig: SimulationWorkflowConfigService,
  ) {}

  @Query(() => [SimulationEvaluatorWorkerView])
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async simulationEvaluatorWorkers() {
    await this.auth.reconcileOfflineWorkers();
    const workers = await this.prisma.simulationEvaluatorWorker.findMany({
      include: { platformCaches: true },
      orderBy: { createdAt: 'asc' },
    });
    const tasks = await this.prisma.simulationEvaluatorTask.findMany({
      where: {
        kind: SimulationEvaluatorTaskKind.PrebuildPlatformCache,
        status: 'Claimed',
        workerId: { in: workers.map((worker) => worker.id) },
      },
      select: {
        id: true,
        workerId: true,
        progressMessage: true,
        progressPercent: true,
        progressRecords: true,
        progressTotalRecords: true,
        progressBytes: true,
      },
    });
    const claimedEvaluationCounts =
      await this.prisma.simulationEvaluatorTask.groupBy({
        by: ['workerId'],
        where: {
          workerId: { in: workers.map((worker) => worker.id) },
          kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
          status: SimulationEvaluatorTaskStatus.Claimed,
        },
        _count: { _all: true },
      });
    const claimedByWorkerId = new Map(
      claimedEvaluationCounts.map((item) => [item.workerId, item._count._all]),
    );
    const taskByWorkerId = new Map(tasks.map((task) => [task.workerId, task]));
    return workers.map((worker) => {
      const task = taskByWorkerId.get(worker.id);
      return {
        ...worker,
        platformCaches: worker.platformCaches.map((cache) => ({
          ...cache,
          // Queued and building fragments describe their requested window in
          // buildingStartAt/buildingEndAt. Expose that window as coverage too
          // so the existing cache list never renders an empty range.
          coveredStartAt: cache.coveredStartAt ?? cache.buildingStartAt,
          coveredEndAt: cache.coveredEndAt ?? cache.buildingEndAt,
        })),
        lastDiagnostic: this.toDiagnosticView(worker.lastDiagnostic),
        displayName: worker.displayName || `worker-${worker.id.slice(0, 8)}`,
        claimedEvaluationTasks: claimedByWorkerId.get(worker.id) ?? 0,
        evaluationClaimLimit:
          Math.min(worker.activeCapacity, worker.desiredCapacity) *
          SIMULATION_EVALUATOR.workerClaimCapacityMultiplier,
        prebuildProgress: task
          ? {
              taskId: task.id,
              message: task.progressMessage || 'Starting prebuild',
              percent: task.progressPercent,
              records: task.progressRecords.toString(),
              totalRecords: task.progressTotalRecords.toString(),
              bytes: task.progressBytes.toString(),
            }
          : undefined,
      };
    });
  }

  @Query(() => SimulationEvaluatorPipelineView)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async simulationEvaluatorPipeline() {
    const workflow = await this.workflowConfig.get();
    const [
      workers,
      queued,
      ready,
      claimed,
      awaitingFinalization,
      finalizing,
      awaitingEventLogs,
      failed,
      outstanding,
      finalizerCandidates,
      sourceDerivedCandidates,
      sourceDerivedFailed,
    ] = await Promise.all([
      this.prisma.simulationEvaluatorWorker.findMany({
        where: {
          authorizationStatus:
            SimulationEvaluatorWorkerAuthorizationStatus.Approved,
          desiredState: SimulationEvaluatorWorkerDesiredState.Running,
          runtimeStatus: {
            in: [
              SimulationEvaluatorWorkerRuntimeStatus.Free,
              SimulationEvaluatorWorkerRuntimeStatus.Busy,
            ],
          },
        },
        select: { activeCapacity: true, desiredCapacity: true },
      }),
      this.countEvaluationTasks(SimulationEvaluatorTaskStatus.Queued),
      this.countEvaluationTasks(SimulationEvaluatorTaskStatus.Ready),
      this.countEvaluationTasks(SimulationEvaluatorTaskStatus.Claimed),
      this.prisma.simulationExecutionPlan.count({
        where: {
          status: SimulationExecutionPlanStatus.Dispatched,
          evaluatorTask: {
            is: { status: SimulationEvaluatorTaskStatus.Completed },
          },
        },
      }),
      this.prisma.simulationExecutionPlan.count({
        where: { status: SimulationExecutionPlanStatus.Finalizing },
      }),
      this.prisma.simulationExecutionPlan.count({
        where: { status: SimulationExecutionPlanStatus.AwaitingEventLogs },
      }),
      this.prisma.simulationExecutionPlan.count({
        where: { status: SimulationExecutionPlanStatus.Failed },
      }),
      this.prisma.simulationExecutionPlan.count({
        where: {
          status: {
            in: [
              SimulationExecutionPlanStatus.Pending,
              SimulationExecutionPlanStatus.Dispatched,
              SimulationExecutionPlanStatus.Finalizing,
            ],
          },
        },
      }),
      this.prisma.simulation.findMany({
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
          totalSimulationPlans: { gt: 0 },
          executionPlans: {
            some: { status: SimulationExecutionPlanStatus.AwaitingEventLogs },
            none: {
              status: { not: SimulationExecutionPlanStatus.AwaitingEventLogs },
            },
          },
        },
        select: {
          totalSimulationPlans: true,
          automationLeaseToken: true,
          automationLeaseExpiresAt: true,
          _count: { select: { executionPlans: true } },
        },
      }),
      this.prisma.simulation.findMany({
        where: {
          sourceSimulationId: { not: null },
          status: SimulationStatus.Running,
          research: {
            is: {
              automationEnabled: true,
              status: { notIn: [SimulationStatus.Cancelled] },
            },
          },
        },
        select: {
          status: true,
          totalSimulationPlans: true,
          automationLeaseToken: true,
          automationLeaseExpiresAt: true,
          _count: { select: { simulationPlans: true } },
        },
      }),
      this.prisma.simulation.count({
        where: {
          sourceSimulationId: { not: null },
          status: SimulationStatus.Failed,
        },
      }),
    ]);
    const fleetCapacity = workers.reduce(
      (total, worker) =>
        total + Math.min(worker.activeCapacity, worker.desiredCapacity),
      0,
    );
    const finalizerBacklog = awaitingFinalization + finalizing;
    const completeFinalizerCandidates = finalizerCandidates.filter(
      (simulation) =>
        simulation._count.executionPlans === simulation.totalSimulationPlans,
    );
    const finalizingSimulations = completeFinalizerCandidates.filter(
      (simulation) =>
        simulation.automationLeaseToken !== null &&
        simulation.automationLeaseExpiresAt !== null &&
        simulation.automationLeaseExpiresAt > new Date(),
    ).length;
    const now = new Date();
    const sourceDerivedRecalculating = sourceDerivedCandidates.filter(
      (simulation) =>
        simulation.status === SimulationStatus.Running &&
        simulation.automationLeaseToken !== null &&
        simulation.automationLeaseExpiresAt !== null &&
        simulation.automationLeaseExpiresAt > now,
    ).length;
    const sourceDerivedWaitingToMaterialize = sourceDerivedCandidates.filter(
      (simulation) =>
        simulation.status === SimulationStatus.Running &&
        simulation._count.simulationPlans === 0 &&
        (simulation.automationLeaseToken === null ||
          simulation.automationLeaseExpiresAt === null ||
          simulation.automationLeaseExpiresAt <= now),
    ).length;
    const sourceDerivedReadyToRecalculate = sourceDerivedCandidates.filter(
      (simulation) =>
        simulation.status === SimulationStatus.Running &&
        simulation.totalSimulationPlans > 0 &&
        simulation._count.simulationPlans === simulation.totalSimulationPlans &&
        (simulation.automationLeaseToken === null ||
          simulation.automationLeaseExpiresAt === null ||
          simulation.automationLeaseExpiresAt <= now),
    ).length;
    return {
      fleetCapacity,
      queueLowWatermark:
        fleetCapacity *
        SIMULATION_EVALUATOR.queueLowWatermarkCapacityMultiplier,
      queueHighWatermark:
        fleetCapacity *
        SIMULATION_EVALUATOR.queueHighWatermarkCapacityMultiplier,
      workerClaimLimit:
        fleetCapacity * SIMULATION_EVALUATOR.workerClaimCapacityMultiplier,
      queuedEvaluationTasks: queued,
      readyEvaluationTasks: ready,
      claimedEvaluationTasks: claimed,
      awaitingFinalizationPlans: awaitingFinalization,
      finalizingPlans: finalizing,
      awaitingEventLogPlans: awaitingEventLogs,
      readyToFinalizeSimulations:
        completeFinalizerCandidates.length - finalizingSimulations,
      finalizingSimulations,
      failedExecutionPlans: failed,
      outstandingExecutionPlans: outstanding,
      finalizerConcurrency: workflow.finalizerConcurrency,
      maxAwaitingFinalizationPlans: workflow.maxAwaitingFinalizationPlans,
      maxOutstandingDynamicPlans: workflow.maxOutstandingDynamicPlans,
      backpressureActive:
        finalizerBacklog >= workflow.maxAwaitingFinalizationPlans,
      sourceDerivedWaitingToMaterialize,
      sourceDerivedReadyToRecalculate,
      sourceDerivedRecalculating,
      sourceDerivedFailed,
    };
  }

  private countEvaluationTasks(status: SimulationEvaluatorTaskStatus) {
    return this.prisma.simulationEvaluatorTask.count({
      where: { kind: SimulationEvaluatorTaskKind.EvaluateLeaders, status },
    });
  }

  private toDiagnosticView(value: unknown) {
    if (!value || typeof value !== 'object') return null;
    const diagnostic = value as Record<string, unknown>;
    const date = (input: unknown) =>
      typeof input === 'string' && !Number.isNaN(new Date(input).getTime())
        ? new Date(input)
        : null;
    const logs = Array.isArray(diagnostic.recentLogs)
      ? diagnostic.recentLogs.flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          const log = entry as Record<string, unknown>;
          const at = date(log.at);
          return at &&
            typeof log.level === 'string' &&
            typeof log.message === 'string'
            ? [{ at, level: log.level, message: log.message }]
            : [];
        })
      : [];
    return {
      ...diagnostic,
      lastPollAt: date(diagnostic.lastPollAt),
      recentLogs: logs,
    };
  }

  @Mutation(() => SimulationEvaluatorWorkerView)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  approveSimulationEvaluatorWorker(@Args('workerId') workerId: string) {
    return this.auth.approve(workerId);
  }

  @Mutation(() => SimulationEvaluatorWorkerView)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  rejectSimulationEvaluatorWorker(@Args('workerId') workerId: string) {
    return this.auth.reject(workerId);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  removeRejectedSimulationEvaluatorWorker(@Args('workerId') workerId: string) {
    return this.auth.removeRejected(workerId);
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  removeOfflineSimulationEvaluatorWorker(@Args('workerId') workerId: string) {
    return this.auth.removeOfflineWorker(workerId);
  }

  @Mutation(() => SimulationEvaluatorWorkerView)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async pauseSimulationEvaluatorWorker(@Args('workerId') workerId: string) {
    return this.prisma.simulationEvaluatorWorker.update({
      where: { id: workerId },
      data: { desiredState: SimulationEvaluatorWorkerDesiredState.Draining },
    });
  }

  @Mutation(() => SimulationEvaluatorWorkerView)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async resumeSimulationEvaluatorWorker(@Args('workerId') workerId: string) {
    return this.prisma.simulationEvaluatorWorker.update({
      where: { id: workerId },
      data: { desiredState: SimulationEvaluatorWorkerDesiredState.Running },
    });
  }

  @Mutation(() => String)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async setSimulationEvaluatorWorkerCapacity(
    @Args('workerId') workerId: string,
    @Args('capacity') capacity: number,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 64) {
      throw new Error('Capacity must be an integer from 1 to 64');
    }
    const worker = await this.prisma.simulationEvaluatorWorker.update({
      where: { id: workerId },
      data: { desiredCapacity: capacity },
    });
    const task = await this.tasks.createTask({
      kind: SimulationEvaluatorTaskKind.SetWorkerCapacity,
      targetWorkerId: worker.id,
      rangeStartedAt: new Date(),
      rangeEndedAt: new Date(),
      input: { capacity },
    });
    return task.id;
  }

  @Mutation(() => String)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async upgradeSimulationEvaluatorWorker(
    @Args('workerId') workerId: string,
    @Args('version') version: string,
  ) {
    if (!isReleaseVersion(version)) {
      throw new Error('Version must use semver format, for example 1.2.3');
    }
    const worker = await this.prisma.simulationEvaluatorWorker.findUnique({
      where: { id: workerId },
      select: { id: true, authorizationStatus: true, version: true },
    });
    if (!worker) throw new Error('Worker not found');
    if (
      worker.authorizationStatus !==
      SimulationEvaluatorWorkerAuthorizationStatus.Approved
    ) {
      throw new Error('Only approved workers can be upgraded');
    }
    if (!worker.version) {
      throw new Error(
        'This worker does not support self-upgrade; install a versioned release manually first',
      );
    }
    if (!isNewerReleaseVersion(version, worker.version)) {
      throw new Error(
        `Version ${version} must be newer than installed version ${worker.version}`,
      );
    }
    const now = new Date();
    const task = await this.tasks.createTask({
      kind: SimulationEvaluatorTaskKind.UpgradeWorker,
      targetWorkerId: worker.id,
      rangeStartedAt: now,
      rangeEndedAt: now,
      // Include a request nonce so an admin can retry a download/replacement
      // failure for the same release version.
      input: {
        version,
        releaseUrl: EVALUATOR_WORKER_RELEASE_URL(version),
        requestedAt: now.toISOString(),
      },
    });
    return task.id;
  }

  @Mutation(() => String)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async prebuildSimulationEvaluatorWorker(
    @Args('workerId') workerId: string,
    @Args('platform') platformText: string,
    @Args('startedAt') startedAtText: string,
    @Args('endedAt') endedAtText: string,
    @Args('refreshExisting', { type: () => Boolean, nullable: true })
    refreshExisting = false,
  ) {
    if (!Object.values(Platform).includes(platformText as Platform))
      throw new Error('Invalid platform');
    const startedAt = new Date(startedAtText);
    const endedAt = new Date(endedAtText);
    if (
      Number.isNaN(+startedAt) ||
      Number.isNaN(+endedAt) ||
      startedAt >= endedAt
    )
      throw new Error('Invalid cache range');
    const platform = platformText as Platform;
    // A fresh request supersedes unfinished cache commands for the same
    // window. This replaces older, oversized prebuild jobs with the bounded
    // month-sized jobs created below.
    await this.prisma.simulationEvaluatorTask.deleteMany({
      where: {
        kind: SimulationEvaluatorTaskKind.PrebuildPlatformCache,
        targetWorkerId: workerId,
        platform,
        status: {
          in: [
            SimulationEvaluatorTaskStatus.Queued,
            SimulationEvaluatorTaskStatus.Ready,
          ],
        },
        requiredCacheStartAt: { lt: endedAt },
        requiredCacheEndAt: { gt: startedAt },
      },
    });
    const ranges = refreshExisting
      ? [{ coveredStartAt: startedAt, coveredEndAt: endedAt }]
      : missingRanges(
          (
            await this.prisma.simulationEvaluatorWorkerPlatformCache.findMany({
              where: {
                workerId,
                platform,
                status: SimulationEvaluatorWorkerPlatformCacheStatus.Ready,
                coveredStartAt: { not: null },
                coveredEndAt: { not: null },
              },
              select: { coveredStartAt: true, coveredEndAt: true },
            })
          ).map((fragment) => ({
            coveredStartAt: fragment.coveredStartAt!,
            coveredEndAt: fragment.coveredEndAt!,
          })),
          startedAt,
          endedAt,
        );
    const tasks = await this.createPrebuildTasks(
      workerId,
      platform,
      ranges,
      refreshExisting,
    );
    // The GraphQL contract predates multi-fragment prebuilds. Return all task
    // IDs while callers that only need success can continue ignoring the value.
    return tasks.map((task) => task.id).join(',');
  }

  @Query(() => [SimulationEvaluatorWorkerTaskView])
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async simulationEvaluatorWorkerTasks(
    @Args('workerId', { type: () => String, nullable: true }) workerId?: string,
  ) {
    const tasks = await this.prisma.simulationEvaluatorTask.findMany({
      where: workerId
        ? { OR: [{ targetWorkerId: workerId }, { workerId }] }
        : // The admin fleet view is also the queue monitor.  Do not hide work
          // that has not been assigned yet: it is the most important state when
          // diagnosing why an evaluator fleet is not making progress.
          {},
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    const now = new Date();
    return tasks.map((task) => ({
      ...task,
      syncStatus:
        task.status === SimulationEvaluatorTaskStatus.Queued
          ? 'Awaiting dispatcher'
          : task.status === SimulationEvaluatorTaskStatus.Ready
            ? 'Waiting for worker poll'
            : task.status === SimulationEvaluatorTaskStatus.Claimed
              ? task.leaseExpiresAt && task.leaseExpiresAt > now
                ? 'Worker lease active'
                : 'Worker lease expired'
              : task.status === SimulationEvaluatorTaskStatus.Completed
                ? 'Worker completed'
                : task.status === SimulationEvaluatorTaskStatus.Failed
                  ? 'Worker failed'
                  : 'Cancelled',
      progressMessage: task.progressMessage || '',
      progressRecords: task.progressRecords.toString(),
      progressTotalRecords: task.progressTotalRecords.toString(),
      progressBytes: task.progressBytes.toString(),
      timingJson: this.toTimingJson(task.result),
      canCancel:
        task.workerId === null &&
        (task.status === SimulationEvaluatorTaskStatus.Queued ||
          task.status === SimulationEvaluatorTaskStatus.Ready),
    }));
  }

  @Query(() => SimulationEvaluatorWorkerTaskConnection)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async simulationEvaluatorWorkerTaskConnection(
    @Args('workerId', { type: () => String }) workerId: string,
    @Args('archive', { type: () => Boolean, defaultValue: false })
    archive: boolean,
    @Args('cursor', { type: () => String, nullable: true }) cursor?: string,
    @Args('limit', { type: () => Int, defaultValue: 30 }) limit = 30,
  ): Promise<SimulationEvaluatorWorkerTaskConnection> {
    const now = new Date();
    const liveStatuses = [
      SimulationEvaluatorTaskStatus.Queued,
      SimulationEvaluatorTaskStatus.Ready,
      SimulationEvaluatorTaskStatus.Claimed,
    ];
    const tasks = await this.prisma.simulationEvaluatorTask.findMany({
      where: {
        OR: [{ targetWorkerId: workerId }, { workerId }],
        status: archive ? { notIn: liveStatuses } : { in: liveStatuses },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: Math.min(Math.max(limit, 1), 100) + 1,
    });
    const hasMore = tasks.length > Math.min(Math.max(limit, 1), 100);
    const page = hasMore ? tasks.slice(0, -1) : tasks;
    return {
      items: page.map((task) => this.toWorkerTaskView(task, now)),
      nextCursor: hasMore ? page.at(-1)?.id || null : null,
    };
  }

  private toWorkerTaskView(task: any, now: Date) {
    return {
      ...task,
      syncStatus:
        task.status === SimulationEvaluatorTaskStatus.Queued
          ? 'Awaiting dispatcher'
          : task.status === SimulationEvaluatorTaskStatus.Ready
            ? 'Waiting for worker poll'
            : task.status === SimulationEvaluatorTaskStatus.Claimed
              ? task.leaseExpiresAt && task.leaseExpiresAt > now
                ? 'Worker lease active'
                : 'Worker lease expired'
              : task.status === SimulationEvaluatorTaskStatus.Completed
                ? 'Worker completed'
                : task.status === SimulationEvaluatorTaskStatus.Failed
                  ? 'Worker failed'
                  : 'Cancelled',
      progressMessage: task.progressMessage || '',
      progressRecords: task.progressRecords.toString(),
      progressTotalRecords: task.progressTotalRecords.toString(),
      progressBytes: task.progressBytes.toString(),
      timingJson: this.toTimingJson(task.result),
      canCancel:
        task.workerId === null &&
        [
          SimulationEvaluatorTaskStatus.Queued,
          SimulationEvaluatorTaskStatus.Ready,
        ].includes(task.status),
    };
  }

  private toTimingJson(result: unknown) {
    if (!result || typeof result !== 'object') return null;
    const timing = (result as Record<string, unknown>).timing;
    return timing && typeof timing === 'object' ? JSON.stringify(timing) : null;
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async cancelUnassignedSimulationEvaluatorWorkerTask(
    @Args('taskId') taskId: string,
  ) {
    const cancelled = await this.prisma.simulationEvaluatorTask.updateMany({
      where: {
        id: taskId,
        workerId: null,
        status: {
          in: [
            SimulationEvaluatorTaskStatus.Queued,
            SimulationEvaluatorTaskStatus.Ready,
          ],
        },
      },
      data: {
        status: SimulationEvaluatorTaskStatus.Cancelled,
        dedupeKey: null,
        completedAt: new Date(),
        lastError: 'Cancelled by an administrator before worker assignment',
      },
    });
    return cancelled.count === 1;
  }

  @Mutation(() => String)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async retrySimulationEvaluatorWorkerCache(
    @Args('cacheId', { type: () => Int }) cacheId: number,
  ) {
    const cache =
      await this.prisma.simulationEvaluatorWorkerPlatformCache.findUnique({
        where: { id: cacheId },
      });
    if (
      !cache ||
      cache.status !== SimulationEvaluatorWorkerPlatformCacheStatus.Failed ||
      !cache.buildingStartAt ||
      !cache.buildingEndAt
    ) {
      throw new Error(
        'Only failed cache builds with a recorded range can retry',
      );
    }
    const pendingTask = await this.prisma.simulationEvaluatorTask.findFirst({
      where: {
        kind: SimulationEvaluatorTaskKind.PrebuildPlatformCache,
        targetWorkerId: cache.workerId,
        platform: cache.platform,
        requiredCacheStartAt: cache.buildingStartAt,
        requiredCacheEndAt: cache.buildingEndAt,
        status: {
          in: [
            SimulationEvaluatorTaskStatus.Queued,
            SimulationEvaluatorTaskStatus.Ready,
            SimulationEvaluatorTaskStatus.Claimed,
          ],
        },
      },
      select: { id: true },
    });
    if (pendingTask) {
      await this.prisma.simulationEvaluatorWorkerPlatformCache.update({
        where: { id: cache.id },
        data: {
          status: SimulationEvaluatorWorkerPlatformCacheStatus.Queued,
          lastError: null,
        },
      });
      return pendingTask.id;
    }

    await this.prisma.simulationEvaluatorWorkerPlatformCache.update({
      where: { id: cache.id },
      data: {
        status: SimulationEvaluatorWorkerPlatformCacheStatus.Queued,
        lastError: null,
      },
    });
    try {
      const tasks = await this.createPrebuildTasks(
        cache.workerId,
        cache.platform,
        [
          {
            coveredStartAt: cache.buildingStartAt,
            coveredEndAt: cache.buildingEndAt,
          },
        ],
      );
      return tasks.map((task) => task.id).join(',');
    } catch (error) {
      await this.prisma.simulationEvaluatorWorkerPlatformCache.update({
        where: { id: cache.id },
        data: {
          status: SimulationEvaluatorWorkerPlatformCacheStatus.Failed,
          lastError:
            error instanceof Error
              ? error.message.slice(0, 2_000)
              : String(error).slice(0, 2_000),
        },
      });
      throw error;
    }
  }

  @Mutation(() => Boolean)
  @Roles(UserPermission.Admin)
  @UseGuards(GqlAuthGuard, RolesGuard)
  async removeSimulationEvaluatorWorkerCache(
    @Args('cacheId', { type: () => Int }) cacheId: number,
  ) {
    const cache =
      await this.prisma.simulationEvaluatorWorkerPlatformCache.findUnique({
        where: { id: cacheId },
      });
    if (!cache) return false;
    if (cache.status === SimulationEvaluatorWorkerPlatformCacheStatus.Building)
      throw new Error('Cannot remove a cache build while it is running');
    if (cache.buildingStartAt && cache.buildingEndAt) {
      await this.prisma.simulationEvaluatorTask.deleteMany({
        where: {
          kind: SimulationEvaluatorTaskKind.PrebuildPlatformCache,
          targetWorkerId: cache.workerId,
          platform: cache.platform,
          requiredCacheStartAt: cache.buildingStartAt,
          requiredCacheEndAt: cache.buildingEndAt,
          status: {
            in: [
              SimulationEvaluatorTaskStatus.Queued,
              SimulationEvaluatorTaskStatus.Ready,
              SimulationEvaluatorTaskStatus.Failed,
            ],
          },
        },
      });
    }
    await this.prisma.simulationEvaluatorWorkerPlatformCache.delete({
      where: { id: cacheId },
    });
    return true;
  }

  private async createPrebuildTasks(
    workerId: string,
    platform: Platform,
    ranges: Array<{ coveredStartAt: Date; coveredEndAt: Date }>,
    refreshExisting = false,
  ) {
    return Promise.all(
      ranges
        .flatMap((range) => this.splitPrebuildRange(range))
        .map((range) =>
          this.tasks.createTask({
            kind: SimulationEvaluatorTaskKind.PrebuildPlatformCache,
            targetWorkerId: workerId,
            platform,
            requiredCacheStartAt: range.coveredStartAt,
            requiredCacheEndAt: range.coveredEndAt,
            rangeStartedAt: range.coveredStartAt,
            rangeEndedAt: range.coveredEndAt,
            input: {
              platform,
              eventLogWindowStartedAt: range.coveredStartAt.toISOString(),
              eventLogWindowEndedAt: range.coveredEndAt.toISOString(),
              refreshExisting,
            },
          }),
        ),
    );
  }

  private splitPrebuildRange(range: {
    coveredStartAt: Date;
    coveredEndAt: Date;
  }) {
    const ranges: Array<{ coveredStartAt: Date; coveredEndAt: Date }> = [];
    let coveredStartAt = new Date(range.coveredStartAt);
    while (coveredStartAt < range.coveredEndAt) {
      const nextMonth = new Date(coveredStartAt);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const coveredEndAt =
        nextMonth < range.coveredEndAt ? nextMonth : range.coveredEndAt;
      ranges.push({ coveredStartAt, coveredEndAt });
      coveredStartAt = coveredEndAt;
    }
    return ranges;
  }
}

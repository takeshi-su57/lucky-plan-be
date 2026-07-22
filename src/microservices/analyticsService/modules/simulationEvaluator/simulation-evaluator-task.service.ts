import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { createHash, randomUUID } from 'crypto';

import {
  SimulationEvaluatorTaskStatus,
  SimulationEvaluatorTaskKind,
  SimulationEvaluatorWorkerAuthorizationStatus,
  SimulationEvaluatorWorkerDesiredState,
  SimulationEvaluatorWorkerPlatformCacheStatus,
  SimulationEvaluatorWorkerRuntimeStatus,
} from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/global/prisma.service';
import { SimulationWorkflowConfigService } from 'src/global/simulation-workflow-config.service';
import { SERVICE_NAMES } from 'src/utils/constants';
import {
  ClaimedSimulationEvaluatorTask,
  CompleteSimulationEvaluatorTaskInput,
  CreateSimulationEvaluatorTaskInput,
} from './simulation-evaluator-task.types';
import { SIMULATION_EVALUATOR } from './simulation-evaluator.constants';
import { coversRange, mergeRanges } from './simulation-evaluator-coverage';

@Injectable()
export class SimulationEvaluatorTaskService
  implements OnModuleInit, OnModuleDestroy
{
  private queue?: Queue;
  private dispatcher?: Worker;
  private dispatchTimer?: NodeJS.Timeout;
  private readonly logger = new Logger(SimulationEvaluatorTaskService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflowConfig: SimulationWorkflowConfigService,
  ) {}

  async onModuleInit() {
    const isAnalytics = process.env.SERVICE === SERVICE_NAMES.ANALYTICS_SERVICE;
    const isApi = process.env.SERVICE === SERVICE_NAMES.API_SERVICE;
    if (!isAnalytics && !isApi) return;

    const connection = {
      host: process.env.REDIS_HOST || 'localhost',
      port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
      maxRetriesPerRequest: null,
    };

    this.queue = new Queue(SIMULATION_EVALUATOR.queueName, { connection });
    if (isAnalytics)
      this.dispatcher = new Worker(
        SIMULATION_EVALUATOR.queueName,
        async (job) => {
          const taskId = job.data.taskId as string;
          await this.prisma.simulationEvaluatorTask.updateMany({
            where: {
              id: taskId,
              status: SimulationEvaluatorTaskStatus.Queued,
            },
            data: { status: SimulationEvaluatorTaskStatus.Ready },
          });
        },
        { connection, concurrency: 4 },
      );
    await this.enqueueQueuedTasks();
    if (isAnalytics) await this.recordDispatcherHeartbeat();
    if (isAnalytics)
      this.dispatchTimer = setInterval(() => {
        this.runDispatcherMaintenance('recording dispatcher heartbeat', () =>
          this.recordDispatcherHeartbeat(),
        );
        this.runDispatcherMaintenance('reconciling stale idle workers', () =>
          this.reconcileStaleIdleWorkers(),
        );
        this.runDispatcherMaintenance('reconciling expired task leases', () =>
          this.reconcileExpiredClaims(),
        );
        this.runDispatcherMaintenance('enqueueing queued tasks', () =>
          this.enqueueQueuedTasks(),
        );
      }, 5_000);
  }

  async onModuleDestroy() {
    if (this.dispatchTimer) clearInterval(this.dispatchTimer);
    await this.dispatcher?.close();
    await this.queue?.close();
  }

  async createTask(input: CreateSimulationEvaluatorTaskInput) {
    if (process.env.SERVICE === SERVICE_NAMES.API_SERVICE) {
      const dispatcher =
        await this.prisma.simulationEvaluatorDispatcher.findUnique({
          where: { id: 'analytics' },
        });
      if (
        !dispatcher ||
        dispatcher.lastHeartbeatAt < new Date(Date.now() - 15_000)
      ) {
        throw new ServiceUnavailableException(
          'Simulation evaluator dispatcher is offline',
        );
      }
    }
    const inputChecksum = this.checksum(input.input);
    const dedupeKey = this.taskDedupeKey(input, inputChecksum);
    // A research retry must continue waiting for an in-flight evaluator task
    // instead of dispatching a duplicate evaluation for the same range.
    const existing = await this.prisma.simulationEvaluatorTask.findFirst({
      where: {
        kind: input.kind,
        simulationId: input.simulationId,
        simulationPlanId: input.simulationPlanId,
        rangeStartedAt: input.rangeStartedAt,
        rangeEndedAt: input.rangeEndedAt,
        inputChecksum,
        targetWorkerId: input.targetWorkerId,
        status: {
          in: [
            SimulationEvaluatorTaskStatus.Queued,
            SimulationEvaluatorTaskStatus.Ready,
            SimulationEvaluatorTaskStatus.Claimed,
            SimulationEvaluatorTaskStatus.Completed,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;
    let task;
    try {
      task = await this.prisma.simulationEvaluatorTask.create({
        data: {
          kind: input.kind,
          simulationId: input.simulationId,
          simulationPlanId: input.simulationPlanId,
          platform: input.platform,
          targetWorkerId: input.targetWorkerId,
          requiredCacheStartAt: input.requiredCacheStartAt,
          requiredCacheEndAt: input.requiredCacheEndAt,
          rangeStartedAt: input.rangeStartedAt,
          rangeEndedAt: input.rangeEndedAt,
          input: input.input as Prisma.InputJsonValue,
          inputChecksum,
          dedupeKey,
        },
      });
    } catch (error) {
      if (!this.isUniqueConstraintError(error)) throw error;
      const concurrentTask =
        await this.prisma.simulationEvaluatorTask.findUnique({
          where: { dedupeKey },
        });
      if (!concurrentTask) throw error;
      return concurrentTask;
    }

    if (this.queue) await this.enqueueQueuedTasks();

    return task;
  }

  async countReadyWorkers(
    platform: import('generated/prisma/enums').Platform,
    requiredCacheStartAt: Date,
    requiredCacheEndAt: Date,
    includeClaimedCapacity = false,
  ) {
    const heartbeatCutoff = this.getWorkerHeartbeatCutoff();
    const workers = await this.prisma.simulationEvaluatorWorker.findMany({
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
        lastHeartbeatAt: { gte: heartbeatCutoff },
        platformCaches: {
          some: {
            platform,
            status: SimulationEvaluatorWorkerPlatformCacheStatus.Ready,
          },
        },
      },
      include: {
        platformCaches: {
          where: {
            platform,
            status: SimulationEvaluatorWorkerPlatformCacheStatus.Ready,
            coveredStartAt: { not: null },
            coveredEndAt: { not: null },
          },
        },
      },
    });
    const eligibleWorkers = workers.filter((worker) =>
      coversRange(
        worker.platformCaches.map((cache) => ({
          coveredStartAt: cache.coveredStartAt!,
          coveredEndAt: cache.coveredEndAt!,
        })),
        requiredCacheStartAt,
        requiredCacheEndAt,
      ),
    );
    const activeCounts = await this.prisma.simulationEvaluatorTask.groupBy({
      by: ['workerId'],
      where: {
        workerId: { in: eligibleWorkers.map((worker) => worker.id) },
        kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
        status: SimulationEvaluatorTaskStatus.Claimed,
      },
      _count: { _all: true },
    });
    const activeByWorkerId = new Map(
      activeCounts.map((item) => [item.workerId, item._count._all]),
    );
    return eligibleWorkers.reduce(
      (available, worker) =>
        available +
        Math.max(
          0,
          this.getSchedulingCapacity(worker) -
            (includeClaimedCapacity ? 0 : activeByWorkerId.get(worker.id) || 0),
        ),
      0,
    );
  }

  async claimNextTask(
    workerId: string,
  ): Promise<ClaimedSimulationEvaluatorTask | null> {
    const now = new Date();
    const workflow = await this.workflowConfig.get();
    await this.reconcileExpiredClaims(now);

    const worker = await this.prisma.simulationEvaluatorWorker.findUnique({
      where: { id: workerId },
      include: { platformCaches: true },
    });
    if (
      !worker ||
      worker.authorizationStatus !==
        SimulationEvaluatorWorkerAuthorizationStatus.Approved ||
      (worker.runtimeStatus !== SimulationEvaluatorWorkerRuntimeStatus.Free &&
        worker.runtimeStatus !== SimulationEvaluatorWorkerRuntimeStatus.Busy &&
        // A worker process can restart after the task lease has ended, leaving
        // a stale Prebuilding status. The active-task check below prevents a
        // second exclusive task while allowing an idle worker to self-heal.
        worker.runtimeStatus !==
          SimulationEvaluatorWorkerRuntimeStatus.Prebuilding) ||
      worker.desiredState !== SimulationEvaluatorWorkerDesiredState.Running
    )
      return null;
    if (!this.isWorkerHeartbeatFresh(worker.lastHeartbeatAt, now)) {
      await this.markIdleWorkerOffline(workerId);
      return null;
    }

    const readyCaches = worker.platformCaches.filter(
      (cache) =>
        cache.status === SimulationEvaluatorWorkerPlatformCacheStatus.Ready &&
        cache.coveredStartAt !== null &&
        cache.coveredEndAt !== null,
    );
    const cachedPlatforms = [
      ...new Set(readyCaches.map((cache) => cache.platform)),
    ];
    const activeTasks = await this.prisma.simulationEvaluatorTask.findMany({
      where: {
        workerId,
        status: SimulationEvaluatorTaskStatus.Claimed,
        leaseExpiresAt: { gt: now },
      },
      select: { kind: true },
    });
    const activeEvaluationCount = activeTasks.filter(
      (task) => task.kind === SimulationEvaluatorTaskKind.EvaluateLeaders,
    ).length;
    const hasExclusiveTask = activeTasks.some(
      (task) => task.kind !== SimulationEvaluatorTaskKind.EvaluateLeaders,
    );
    if (hasExclusiveTask) return null;

    const readyTasks = await this.prisma.simulationEvaluatorTask.findMany({
      where: {
        status: SimulationEvaluatorTaskStatus.Ready,
        OR: [
          {
            kind: SimulationEvaluatorTaskKind.PrebuildPlatformCache,
            targetWorkerId: workerId,
          },
          {
            kind: SimulationEvaluatorTaskKind.SetWorkerCapacity,
            targetWorkerId: workerId,
          },
          ...(cachedPlatforms.length
            ? [
                {
                  kind: SimulationEvaluatorTaskKind.EvaluateLeaders,
                  platform: { in: cachedPlatforms },
                  OR: [{ targetWorkerId: null }, { targetWorkerId: workerId }],
                },
              ]
            : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: workflow.readyTaskScanLimit,
    });
    const readyTask = readyTasks.find((task) => {
      if (
        task.kind === SimulationEvaluatorTaskKind.PrebuildPlatformCache ||
        task.kind === SimulationEvaluatorTaskKind.SetWorkerCapacity
      ) {
        if (activeEvaluationCount > 0) return false;
        return task.targetWorkerId === workerId;
      }
      // A capacity update is an exclusive task, so it cannot run until active
      // evaluations drain. Respect a lower desired capacity before the worker
      // has applied the command; otherwise every freed slot is immediately
      // refilled and scale-down can never complete under continuous load.
      if (activeEvaluationCount >= this.getSchedulingCapacity(worker))
        return false;
      if (
        !task.platform ||
        !task.requiredCacheStartAt ||
        !task.requiredCacheEndAt
      )
        return false;
      return coversRange(
        readyCaches
          .filter((cache) => cache.platform === task.platform)
          .map((cache) => ({
            coveredStartAt: cache.coveredStartAt!,
            coveredEndAt: cache.coveredEndAt!,
          })),
        task.requiredCacheStartAt,
        task.requiredCacheEndAt,
      );
    });
    if (!readyTask) {
      await this.recordWorkerHeartbeat(
        workerId,
        SimulationEvaluatorWorkerRuntimeStatus.Free,
      );
      return null;
    }

    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(
      now.getTime() + workflow.evaluatorTaskLeaseMs,
    );
    const runtimeStatus =
      readyTask.kind === SimulationEvaluatorTaskKind.PrebuildPlatformCache
        ? SimulationEvaluatorWorkerRuntimeStatus.Prebuilding
        : SimulationEvaluatorWorkerRuntimeStatus.Busy;
    const reservedWorker =
      await this.prisma.simulationEvaluatorWorker.updateMany({
        where: {
          id: workerId,
          authorizationStatus:
            SimulationEvaluatorWorkerAuthorizationStatus.Approved,
          runtimeStatus: {
            in: [
              SimulationEvaluatorWorkerRuntimeStatus.Free,
              SimulationEvaluatorWorkerRuntimeStatus.Busy,
              SimulationEvaluatorWorkerRuntimeStatus.Prebuilding,
            ],
          },
        },
        data: { runtimeStatus, lastHeartbeatAt: now, lastTaskAt: now },
      });
    if (reservedWorker.count !== 1) return null;
    const claimed = await this.prisma.simulationEvaluatorTask.updateMany({
      where: {
        id: readyTask.id,
        status: SimulationEvaluatorTaskStatus.Ready,
      },
      data: {
        status: SimulationEvaluatorTaskStatus.Claimed,
        workerId,
        leaseToken,
        leaseExpiresAt,
        claimedAt: now,
      },
    });
    if (claimed.count === 0) {
      await this.recordWorkerHeartbeat(
        workerId,
        SimulationEvaluatorWorkerRuntimeStatus.Free,
      );
      return null;
    }
    if (
      readyTask.kind === SimulationEvaluatorTaskKind.PrebuildPlatformCache &&
      readyTask.platform
    ) {
      const building =
        await this.prisma.simulationEvaluatorWorkerPlatformCache.updateMany({
          where: {
            workerId,
            platform: readyTask.platform,
            status: {
              in: [
                SimulationEvaluatorWorkerPlatformCacheStatus.Queued,
                SimulationEvaluatorWorkerPlatformCacheStatus.Building,
              ],
            },
            buildingStartAt: readyTask.requiredCacheStartAt,
            buildingEndAt: readyTask.requiredCacheEndAt,
          },
          data: {
            status: SimulationEvaluatorWorkerPlatformCacheStatus.Building,
            buildingStartAt: readyTask.requiredCacheStartAt,
            buildingEndAt: readyTask.requiredCacheEndAt,
            lastError: null,
          },
        });
      if (!building.count)
        await this.prisma.simulationEvaluatorWorkerPlatformCache.create({
          data: {
            workerId,
            platform: readyTask.platform,
            status: SimulationEvaluatorWorkerPlatformCacheStatus.Building,
            buildingStartAt: readyTask.requiredCacheStartAt,
            buildingEndAt: readyTask.requiredCacheEndAt,
          },
        });
    }

    return {
      id: readyTask.id,
      kind: readyTask.kind,
      simulationId: readyTask.simulationId,
      simulationPlanId: readyTask.simulationPlanId,
      rangeStartedAt: readyTask.rangeStartedAt,
      rangeEndedAt: readyTask.rangeEndedAt,
      input: readyTask.input as Record<string, unknown>,
      inputChecksum: readyTask.inputChecksum,
      leaseToken,
      leaseExpiresAt,
    };
  }

  async heartbeat(
    taskId: string,
    workerId: string,
    leaseToken: string,
    progress?: {
      progressPercent?: number;
      progressRecords?: number;
      progressTotalRecords?: number;
      progressBytes?: number;
      progressMessage?: string;
    },
  ) {
    const task = await this.getClaimedTask(taskId, workerId, leaseToken);
    if (!task) return null;
    const workflow = await this.workflowConfig.get();
    const leaseExpiresAt = new Date(Date.now() + workflow.evaluatorTaskLeaseMs);
    const heartbeat = await this.prisma.simulationEvaluatorTask.updateMany({
      where: {
        id: taskId,
        status: SimulationEvaluatorTaskStatus.Claimed,
        workerId,
        leaseToken,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        leaseExpiresAt,
        ...(typeof progress?.progressPercent === 'number' &&
        progress.progressPercent >= 0 &&
        progress.progressPercent <= 100
          ? { progressPercent: progress.progressPercent }
          : {}),
        ...(Number.isSafeInteger(progress?.progressRecords) &&
        (progress?.progressRecords ?? -1) >= 0
          ? { progressRecords: BigInt(progress!.progressRecords!) }
          : {}),
        ...(Number.isSafeInteger(progress?.progressTotalRecords) &&
        (progress?.progressTotalRecords ?? -1) >= 0
          ? { progressTotalRecords: BigInt(progress!.progressTotalRecords!) }
          : {}),
        ...(Number.isSafeInteger(progress?.progressBytes)
          ? { progressBytes: BigInt(progress!.progressBytes!) }
          : {}),
        ...(progress?.progressMessage
          ? { progressMessage: progress.progressMessage.slice(0, 500) }
          : {}),
      },
    });
    if (heartbeat.count === 1) {
      await this.recordWorkerHeartbeat(
        workerId,
        task.kind === SimulationEvaluatorTaskKind.PrebuildPlatformCache
          ? SimulationEvaluatorWorkerRuntimeStatus.Prebuilding
          : SimulationEvaluatorWorkerRuntimeStatus.Busy,
      );
      return leaseExpiresAt;
    }
    return null;
  }

  async getClaimedTask(taskId: string, workerId: string, leaseToken: string) {
    return this.prisma.simulationEvaluatorTask.findFirst({
      where: {
        id: taskId,
        status: SimulationEvaluatorTaskStatus.Claimed,
        workerId,
        leaseToken,
        leaseExpiresAt: { gt: new Date() },
      },
    });
  }

  private getSchedulingCapacity(worker: {
    activeCapacity: number;
    desiredCapacity: number;
  }) {
    return Math.min(worker.activeCapacity, worker.desiredCapacity);
  }

  async complete(input: CompleteSimulationEvaluatorTaskInput) {
    const task = await this.getClaimedTask(
      input.taskId,
      input.workerId,
      input.leaseToken,
    );
    if (!task) return false;
    const prebuildResult =
      task.kind === SimulationEvaluatorTaskKind.PrebuildPlatformCache
        ? this.validatePrebuildResult(
            task.platform,
            task.requiredCacheStartAt,
            task.requiredCacheEndAt,
            input.result,
          )
        : null;
    if (prebuildResult?.error) {
      return this.fail(
        input.taskId,
        input.workerId,
        input.leaseToken,
        prebuildResult.error,
      );
    }
    const capacityResult =
      task.kind === SimulationEvaluatorTaskKind.SetWorkerCapacity
        ? Number(input.result.activeCapacity)
        : null;
    if (
      capacityResult !== null &&
      (!Number.isSafeInteger(capacityResult) || capacityResult < 1)
    ) {
      return this.fail(
        input.taskId,
        input.workerId,
        input.leaseToken,
        'invalid capacity result',
      );
    }
    const completed = await this.prisma.simulationEvaluatorTask.updateMany({
      where: {
        id: input.taskId,
        status: SimulationEvaluatorTaskStatus.Claimed,
        workerId: input.workerId,
        leaseToken: input.leaseToken,
        leaseExpiresAt: { gt: new Date() },
      },
      data: {
        status: SimulationEvaluatorTaskStatus.Completed,
        result: input.result as Prisma.InputJsonValue,
        resultChecksum: this.checksum(input.result),
        completedAt: new Date(),
        progressPercent: 100,
      },
    });
    if (completed.count === 1) {
      if (task.kind === SimulationEvaluatorTaskKind.SetWorkerCapacity) {
        await this.prisma.simulationEvaluatorWorker.updateMany({
          where: { id: input.workerId },
          data: { activeCapacity: capacityResult! },
        });
      }
      if (task.kind === SimulationEvaluatorTaskKind.PrebuildPlatformCache) {
        const coverage = prebuildResult as {
          coveredStartAt: Date;
          coveredEndAt: Date;
        };
        await this.recordCompletedCacheFragment(
          input.workerId,
          task.platform!,
          coverage.coveredStartAt,
          coverage.coveredEndAt,
        );
      }
      await this.refreshWorkerRuntimeStatus(input.workerId);
      return true;
    }
    return false;
  }

  async fail(
    taskId: string,
    workerId: string,
    leaseToken: string,
    error: string,
  ) {
    const task = await this.getClaimedTask(taskId, workerId, leaseToken);
    if (!task) return false;
    const updated = await this.prisma.simulationEvaluatorTask.updateMany({
      where: {
        id: taskId,
        status: SimulationEvaluatorTaskStatus.Claimed,
        workerId,
        leaseToken,
      },
      data: {
        status: SimulationEvaluatorTaskStatus.Failed,
        dedupeKey: null,
        lastError: error.slice(0, 2_000),
        completedAt: new Date(),
      },
    });
    if (!updated.count) return false;
    if (
      task.kind === SimulationEvaluatorTaskKind.PrebuildPlatformCache &&
      task.platform
    ) {
      await this.prisma.simulationEvaluatorWorkerPlatformCache.updateMany({
        where: {
          workerId,
          platform: task.platform,
          status: SimulationEvaluatorWorkerPlatformCacheStatus.Building,
          buildingStartAt: task.requiredCacheStartAt,
          buildingEndAt: task.requiredCacheEndAt,
        },
        data: {
          status: SimulationEvaluatorWorkerPlatformCacheStatus.Failed,
          lastError: error.slice(0, 2_000),
        },
      });
    }
    await this.refreshWorkerRuntimeStatus(workerId);
    return true;
  }

  private async recordCompletedCacheFragment(
    workerId: string,
    platform: import('generated/prisma/enums').Platform,
    coveredStartAt: Date,
    coveredEndAt: Date,
  ) {
    await this.prisma.$transaction(async (prisma) => {
      const existing =
        await prisma.simulationEvaluatorWorkerPlatformCache.findMany({
          where: {
            workerId,
            platform,
            status: SimulationEvaluatorWorkerPlatformCacheStatus.Ready,
            coveredStartAt: { not: null },
            coveredEndAt: { not: null },
          },
        });
      const merged = mergeRanges([
        ...existing.map((cache) => ({
          coveredStartAt: cache.coveredStartAt!,
          coveredEndAt: cache.coveredEndAt!,
        })),
        { coveredStartAt, coveredEndAt },
      ]);

      // Replace the completed fragments with their normalized union. This keeps
      // disjoint ranges, while a new bridge fragment collapses adjacent ranges.
      await prisma.simulationEvaluatorWorkerPlatformCache.deleteMany({
        where: {
          workerId,
          platform,
          status: SimulationEvaluatorWorkerPlatformCacheStatus.Ready,
        },
      });
      await prisma.simulationEvaluatorWorkerPlatformCache.createMany({
        data: merged.map((range) => ({
          workerId,
          platform,
          status: SimulationEvaluatorWorkerPlatformCacheStatus.Ready,
          coveredStartAt: range.coveredStartAt,
          coveredEndAt: range.coveredEndAt,
          lastBuiltAt: new Date(),
          lastError: null,
        })),
      });
      await prisma.simulationEvaluatorWorkerPlatformCache.deleteMany({
        where: {
          workerId,
          platform,
          status: SimulationEvaluatorWorkerPlatformCacheStatus.Building,
          buildingStartAt: coveredStartAt,
          buildingEndAt: coveredEndAt,
        },
      });
    });
  }

  async waitForCompletedTask(taskId: string, timeoutMs = 15 * 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const task = await this.prisma.simulationEvaluatorTask.findUnique({
        where: { id: taskId },
      });
      if (!task)
        throw new Error(`Simulation evaluator task ${taskId} not found`);
      if (task.status === SimulationEvaluatorTaskStatus.Completed) return task;
      if (
        task.status === SimulationEvaluatorTaskStatus.Failed ||
        task.status === SimulationEvaluatorTaskStatus.Cancelled
      ) {
        throw new Error(
          task.lastError || `Simulation evaluator task ${taskId} failed`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Simulation evaluator task ${taskId} timed out`);
  }

  async reconcileExpiredClaims(now = new Date()) {
    const expiredClaims = await this.prisma.simulationEvaluatorTask.findMany({
      where: {
        status: SimulationEvaluatorTaskStatus.Claimed,
        leaseExpiresAt: { lt: now },
        workerId: { not: null },
      },
      select: { workerId: true },
    });
    await this.prisma.simulationEvaluatorTask.updateMany({
      where: {
        status: SimulationEvaluatorTaskStatus.Claimed,
        leaseExpiresAt: { lt: now },
      },
      data: {
        status: SimulationEvaluatorTaskStatus.Ready,
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        claimedAt: null,
      },
    });
    await Promise.all(
      [
        ...new Set(
          expiredClaims.map((claim) => claim.workerId).filter(Boolean),
        ),
      ].map((workerId) => this.markExpiredWorkerOffline(workerId!)),
    );
  }

  private checksum(value: Record<string, unknown>) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private taskDedupeKey(
    input: CreateSimulationEvaluatorTaskInput,
    inputChecksum: string,
  ) {
    return this.checksum({
      kind: input.kind,
      simulationId: input.simulationId ?? null,
      simulationPlanId: input.simulationPlanId ?? null,
      targetWorkerId: input.targetWorkerId ?? null,
      rangeStartedAt: input.rangeStartedAt.toISOString(),
      rangeEndedAt: input.rangeEndedAt.toISOString(),
      inputChecksum,
    });
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }

  async reconcileStaleIdleWorkers() {
    await this.prisma.simulationEvaluatorWorker.updateMany({
      where: {
        runtimeStatus: {
          in: [
            SimulationEvaluatorWorkerRuntimeStatus.Free,
            SimulationEvaluatorWorkerRuntimeStatus.Online,
          ],
        },
        lastHeartbeatAt: { lt: this.getWorkerHeartbeatCutoff() },
      },
      data: { runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Offline },
    });
  }

  private getWorkerHeartbeatCutoff(now = new Date()) {
    return new Date(
      now.getTime() - SIMULATION_EVALUATOR.workerHeartbeatTimeoutMs,
    );
  }

  private isWorkerHeartbeatFresh(
    lastHeartbeatAt: Date | null,
    now = new Date(),
  ) {
    return (
      lastHeartbeatAt !== null &&
      lastHeartbeatAt >= this.getWorkerHeartbeatCutoff(now)
    );
  }

  private validatePrebuildResult(
    taskPlatform: import('generated/prisma/enums').Platform | null,
    requiredCacheStartAt: Date | null,
    requiredCacheEndAt: Date | null,
    result: Record<string, unknown>,
  ):
    | { coveredStartAt: Date; coveredEndAt: Date; error?: never }
    | { error: string; coveredStartAt?: never; coveredEndAt?: never } {
    if (!taskPlatform) {
      return { error: 'invalid prebuild result: task has no platform' };
    }
    if (!requiredCacheStartAt || !requiredCacheEndAt) {
      return { error: 'invalid prebuild result: task has no cache window' };
    }
    if (result.platform !== taskPlatform) {
      return { error: 'invalid prebuild result: platform mismatch' };
    }
    const coveredStartAt = new Date(String(result.coveredStartAt));
    const coveredEndAt = new Date(String(result.coveredEndAt));
    if (
      Number.isNaN(coveredStartAt.getTime()) ||
      Number.isNaN(coveredEndAt.getTime()) ||
      coveredStartAt >= coveredEndAt
    ) {
      return { error: 'invalid prebuild result: invalid coverage window' };
    }
    if (
      coveredStartAt.getTime() !== requiredCacheStartAt.getTime() ||
      coveredEndAt.getTime() !== requiredCacheEndAt.getTime()
    ) {
      return { error: 'invalid prebuild result: coverage window mismatch' };
    }
    return { coveredStartAt, coveredEndAt };
  }

  private runDispatcherMaintenance(
    operation: string,
    callback: () => Promise<void>,
  ) {
    void callback().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed while ${operation}: ${message}`, stack);
    });
  }

  private async recordWorkerHeartbeat(
    workerId: string,
    status: SimulationEvaluatorWorkerRuntimeStatus,
    options: { lastTaskAt?: Date } = {},
  ) {
    const now = new Date();
    await this.prisma.simulationEvaluatorWorker.updateMany({
      where: { id: workerId },
      data: {
        runtimeStatus: status,
        lastHeartbeatAt: now,
        ...(options.lastTaskAt ? { lastTaskAt: options.lastTaskAt } : {}),
      },
    });
  }

  private async refreshWorkerRuntimeStatus(workerId: string) {
    const [worker, activeTaskCount] = await Promise.all([
      this.prisma.simulationEvaluatorWorker.findUnique({
        where: { id: workerId },
      }),
      this.prisma.simulationEvaluatorTask.count({
        where: { workerId, status: SimulationEvaluatorTaskStatus.Claimed },
      }),
    ]);
    if (!worker) return;
    await this.recordWorkerHeartbeat(
      workerId,
      worker.desiredState === SimulationEvaluatorWorkerDesiredState.Draining &&
        activeTaskCount === 0
        ? SimulationEvaluatorWorkerRuntimeStatus.Paused
        : activeTaskCount > 0
          ? SimulationEvaluatorWorkerRuntimeStatus.Busy
          : SimulationEvaluatorWorkerRuntimeStatus.Free,
    );
  }

  private async markExpiredWorkerOffline(workerId: string) {
    const activeClaim = await this.prisma.simulationEvaluatorTask.findFirst({
      where: {
        workerId,
        status: SimulationEvaluatorTaskStatus.Claimed,
        leaseExpiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (activeClaim) return;
    await this.prisma.simulationEvaluatorWorker.updateMany({
      where: {
        id: workerId,
        runtimeStatus: {
          in: [
            SimulationEvaluatorWorkerRuntimeStatus.Busy,
            SimulationEvaluatorWorkerRuntimeStatus.Prebuilding,
          ],
        },
      },
      data: {
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Offline,
      },
    });
  }

  private async markIdleWorkerOffline(workerId: string) {
    await this.prisma.simulationEvaluatorWorker.updateMany({
      where: {
        id: workerId,
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Free,
      },
      data: {
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Offline,
      },
    });
  }

  private async enqueueQueuedTasks() {
    if (!this.queue) return;
    const workflow = await this.workflowConfig.get();
    const tasks = await this.prisma.simulationEvaluatorTask.findMany({
      where: { status: SimulationEvaluatorTaskStatus.Queued },
      select: { id: true },
      take: workflow.queuedTaskBatchSize,
    });
    await Promise.all(
      tasks.map((task) =>
        this.queue!.add(
          'make-evaluator-task-ready',
          { taskId: task.id },
          {
            jobId: task.id,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1_000 },
            removeOnComplete: 1_000,
            removeOnFail: true,
          },
        ),
      ),
    );
  }

  private async recordDispatcherHeartbeat() {
    await this.prisma.simulationEvaluatorDispatcher.upsert({
      where: { id: 'analytics' },
      update: { lastHeartbeatAt: new Date() },
      create: { id: 'analytics', lastHeartbeatAt: new Date() },
    });
  }
}

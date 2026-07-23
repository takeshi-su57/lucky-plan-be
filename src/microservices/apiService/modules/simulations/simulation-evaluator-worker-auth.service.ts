import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { verify } from 'crypto';

import {
  SimulationEvaluatorTaskKind,
  SimulationEvaluatorTaskStatus,
  SimulationEvaluatorWorkerAuthorizationStatus,
  SimulationEvaluatorWorkerRuntimeStatus,
} from 'generated/prisma/enums';
import { Prisma } from 'generated/prisma/client';
import { PrismaService } from 'src/global/prisma.service';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';

const MAX_SIGNATURE_AGE_MS = 2 * 60_000;

@Injectable()
export class SimulationEvaluatorWorkerAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async enroll(
    workerId: string,
    publicKey: string,
    displayName?: string,
    version?: string,
  ) {
    const normalizedDisplayName = displayName?.trim() || null;
    const existing = await this.prisma.simulationEvaluatorWorker.findUnique({
      where: { id: workerId },
    });
    if (existing && existing.publicKey && existing.publicKey !== publicKey) {
      throw new ConflictException(
        'Worker identity key does not match the enrolled worker',
      );
    }

    const now = new Date();
    if (existing) {
      if (
        existing.authorizationStatus !==
        SimulationEvaluatorWorkerAuthorizationStatus.Pending
      ) {
        return {
          authorizationStatus: existing.authorizationStatus,
          desiredCapacity: existing.desiredCapacity,
        };
      }
      await this.prisma.simulationEvaluatorWorker.update({
        where: { id: workerId },
        data: {
          ...(normalizedDisplayName
            ? { displayName: normalizedDisplayName }
            : {}),
          runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Online,
          lastHeartbeatAt: now,
          ...this.versionUpdate(version),
        },
      });
      return {
        authorizationStatus:
          SimulationEvaluatorWorkerAuthorizationStatus.Pending,
        desiredCapacity: existing.desiredCapacity,
      };
    }

    const worker = await this.prisma.simulationEvaluatorWorker.create({
      data: {
        id: workerId,
        publicKey,
        displayName: normalizedDisplayName,
        authorizationStatus:
          SimulationEvaluatorWorkerAuthorizationStatus.Pending,
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Online,
        lastHeartbeatAt: now,
        ...this.versionUpdate(version),
      },
    });
    return {
      authorizationStatus: SimulationEvaluatorWorkerAuthorizationStatus.Pending,
      desiredCapacity: worker.desiredCapacity,
    };
  }

  async authenticate(input: {
    workerId?: string;
    timestamp?: string;
    signature?: string;
    method: string;
    path: string;
  }) {
    if (!input.workerId || !input.timestamp || !input.signature) {
      throw new UnauthorizedException();
    }
    const timestamp = Number(input.timestamp);
    if (
      !Number.isFinite(timestamp) ||
      Math.abs(Date.now() - timestamp) > MAX_SIGNATURE_AGE_MS
    ) {
      throw new UnauthorizedException('Worker signature has expired');
    }
    const worker = await this.prisma.simulationEvaluatorWorker.findUnique({
      where: { id: input.workerId },
    });
    if (
      !worker?.publicKey ||
      worker.authorizationStatus !==
        SimulationEvaluatorWorkerAuthorizationStatus.Approved
    ) {
      throw new UnauthorizedException('Worker is not approved');
    }
    const message = `${input.workerId}\n${timestamp}\n${input.method.toUpperCase()}\n${input.path}`;
    const valid = verify(
      null,
      Buffer.from(message),
      worker.publicKey,
      Buffer.from(input.signature, 'base64'),
    );
    if (!valid) throw new UnauthorizedException('Invalid worker signature');
    return worker;
  }

  async getEnrollment(workerId: string) {
    const worker = await this.prisma.simulationEvaluatorWorker.findUnique({
      where: { id: workerId },
      include: { platformCaches: true },
    });
    if (!worker) throw new UnauthorizedException();
    return worker;
  }

  async recordPresence(workerId: string, version?: string) {
    const now = new Date();
    const activeTask = await this.prisma.simulationEvaluatorTask.findFirst({
      where: {
        workerId,
        status: SimulationEvaluatorTaskStatus.Claimed,
        leaseExpiresAt: { gt: now },
      },
      select: { kind: true },
    });
    await this.prisma.simulationEvaluatorWorker.update({
      where: { id: workerId },
      data: {
        // A worker can restart after a task has failed or its lease has
        // expired. Reconcile the persisted status on every heartbeat so a
        // stale Prebuilding/Busy state cannot prevent it from polling again.
        runtimeStatus: activeTask
          ? activeTask.kind ===
            SimulationEvaluatorTaskKind.PrebuildPlatformCache
            ? SimulationEvaluatorWorkerRuntimeStatus.Prebuilding
            : SimulationEvaluatorWorkerRuntimeStatus.Busy
          : SimulationEvaluatorWorkerRuntimeStatus.Free,
        lastHeartbeatAt: now,
        ...this.versionUpdate(version),
      },
    });
  }

  private versionUpdate(version?: string) {
    return typeof version === 'string' &&
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)
      ? { version, versionReportedAt: new Date() }
      : {};
  }

  async recordDiagnostic(workerId: string, diagnostic: unknown) {
    if (!diagnostic || typeof diagnostic !== 'object') return;
    const input = diagnostic as Record<string, unknown>;
    const integer = (value: unknown) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
        ? value
        : 0;
    const text = (value: unknown, max = 500) =>
      typeof value === 'string' ? value.slice(0, max) : null;
    const logs = Array.isArray(input.recentLogs)
      ? input.recentLogs.slice(-50).flatMap((entry) => {
          if (!entry || typeof entry !== 'object') return [];
          const log = entry as Record<string, unknown>;
          const at = text(log.at, 40);
          const level = text(log.level, 20);
          const message = text(log.message, 1_000);
          return at && !Number.isNaN(new Date(at).getTime()) && level && message
            ? [{ at, level, message }]
            : [];
        })
      : [];
    await this.prisma.simulationEvaluatorWorker.update({
      where: { id: workerId },
      data: {
        lastDiagnostic: {
          pid: integer(input.pid),
          uptimeSeconds: integer(input.uptimeSeconds),
          childCapacity: integer(input.childCapacity),
          childCount: integer(input.childCount),
          idleChildCount: integer(input.idleChildCount),
          runningTaskCount: integer(input.runningTaskCount),
          lastPollAt: text(input.lastPollAt, 40),
          lastPollError: text(input.lastPollError, 1_000),
          recentLogs: logs,
        } as Prisma.InputJsonValue,
        // The parent reports its actual pool size after every restart and
        // resize. Scheduling must use this live value, not a stale result
        // from an earlier SetWorkerCapacity task.
        activeCapacity: Math.max(1, integer(input.childCount)),
        lastDiagnosticAt: new Date(),
      },
    });
  }

  async reconcileOfflineWorkers() {
    await this.prisma.simulationEvaluatorWorker.updateMany({
      where: {
        runtimeStatus: { not: SimulationEvaluatorWorkerRuntimeStatus.Offline },
        lastHeartbeatAt: {
          lt: new Date(
            Date.now() - SIMULATION_EVALUATOR.workerHeartbeatTimeoutMs,
          ),
        },
      },
      data: { runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Offline },
    });
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async reconcileOfflineWorkerSchedule() {
    await this.reconcileOfflineWorkers();
  }

  async approve(workerId: string) {
    return this.prisma.simulationEvaluatorWorker.update({
      where: { id: workerId },
      data: {
        authorizationStatus:
          SimulationEvaluatorWorkerAuthorizationStatus.Approved,
        approvedAt: new Date(),
        rejectedAt: null,
      },
    });
  }

  async reject(workerId: string) {
    return this.prisma.simulationEvaluatorWorker.update({
      where: { id: workerId },
      data: {
        authorizationStatus:
          SimulationEvaluatorWorkerAuthorizationStatus.Rejected,
        rejectedAt: new Date(),
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Offline,
      },
    });
  }

  async removeRejected(workerId: string) {
    const activeTask = await this.prisma.simulationEvaluatorTask.findFirst({
      where: { workerId, status: SimulationEvaluatorTaskStatus.Claimed },
      select: { id: true },
    });
    if (activeTask) {
      throw new ConflictException(
        'A worker with an active task cannot be removed',
      );
    }
    const deleted = await this.prisma.simulationEvaluatorWorker.deleteMany({
      where: { id: workerId },
    });
    if (deleted.count === 0) {
      throw new NotFoundException('Simulation evaluator worker was not found');
    }
    return true;
  }

  async removeOfflineWorker(workerId: string) {
    const worker = await this.prisma.simulationEvaluatorWorker.findUnique({
      where: { id: workerId },
      select: { runtimeStatus: true },
    });
    if (!worker) {
      throw new NotFoundException('Simulation evaluator worker was not found');
    }
    if (
      worker.runtimeStatus !== SimulationEvaluatorWorkerRuntimeStatus.Offline
    ) {
      throw new ConflictException('Only offline workers can be removed');
    }

    const activeTask = await this.prisma.simulationEvaluatorTask.findFirst({
      where: {
        workerId,
        status: SimulationEvaluatorTaskStatus.Claimed,
        leaseExpiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (activeTask) {
      throw new ConflictException(
        'An offline worker with an active task cannot be removed',
      );
    }

    await this.prisma.$transaction([
      this.prisma.simulationEvaluatorTask.deleteMany({
        where: { OR: [{ workerId }, { targetWorkerId: workerId }] },
      }),
      this.prisma.simulationEvaluatorWorkerPlatformCache.deleteMany({
        where: { workerId },
      }),
      this.prisma.simulationEvaluatorWorker.delete({ where: { id: workerId } }),
    ]);
    return true;
  }
}

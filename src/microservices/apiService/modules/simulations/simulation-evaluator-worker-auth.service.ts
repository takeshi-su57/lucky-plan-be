import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { verify } from 'crypto';

import {
  SimulationEvaluatorTaskStatus,
  SimulationEvaluatorWorkerAuthorizationStatus,
  SimulationEvaluatorWorkerRuntimeStatus,
} from 'generated/prisma/enums';
import { PrismaService } from 'src/global/prisma.service';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';

const MAX_SIGNATURE_AGE_MS = 2 * 60_000;

@Injectable()
export class SimulationEvaluatorWorkerAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async enroll(workerId: string, publicKey: string, displayName?: string) {
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
        return existing.authorizationStatus;
      }
      await this.prisma.simulationEvaluatorWorker.update({
        where: { id: workerId },
        data: {
          ...(normalizedDisplayName
            ? { displayName: normalizedDisplayName }
            : {}),
          runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Online,
          lastHeartbeatAt: now,
        },
      });
      return SimulationEvaluatorWorkerAuthorizationStatus.Pending;
    }

    await this.prisma.simulationEvaluatorWorker.create({
      data: {
        id: workerId,
        publicKey,
        displayName: normalizedDisplayName,
        authorizationStatus:
          SimulationEvaluatorWorkerAuthorizationStatus.Pending,
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Online,
        lastHeartbeatAt: now,
      },
    });
    return SimulationEvaluatorWorkerAuthorizationStatus.Pending;
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

  async recordPresence(workerId: string) {
    const now = new Date();
    const becameFree = await this.prisma.simulationEvaluatorWorker.updateMany({
      where: {
        id: workerId,
        runtimeStatus: {
          in: [
            SimulationEvaluatorWorkerRuntimeStatus.Online,
            SimulationEvaluatorWorkerRuntimeStatus.Offline,
          ],
        },
      },
      data: {
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Free,
        lastHeartbeatAt: now,
      },
    });
    if (becameFree.count === 0) {
      await this.prisma.simulationEvaluatorWorker.update({
        where: { id: workerId },
        data: { lastHeartbeatAt: now },
      });
    }
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
}

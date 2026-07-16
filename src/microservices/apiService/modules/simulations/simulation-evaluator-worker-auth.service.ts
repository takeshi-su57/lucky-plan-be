import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { verify } from 'crypto';

import {
  SimulationEvaluatorWorkerAuthorizationStatus,
  SimulationEvaluatorWorkerRuntimeStatus,
} from 'generated/prisma/enums';
import { PrismaService } from 'src/global/prisma.service';

const MAX_SIGNATURE_AGE_MS = 2 * 60_000;

@Injectable()
export class SimulationEvaluatorWorkerAuthService {
  constructor(private readonly prisma: PrismaService) {}

  async enroll(workerId: string, publicKey: string) {
    const existing = await this.prisma.simulationEvaluatorWorker.findUnique({
      where: { id: workerId },
    });
    if (existing && existing.publicKey && existing.publicKey !== publicKey) {
      throw new ConflictException(
        'Worker identity key does not match the enrolled worker',
      );
    }

    const now = new Date();
    await this.prisma.simulationEvaluatorWorker.updateMany({
      where: {
        id: workerId,
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Offline,
      },
      data: {
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Online,
        lastHeartbeatAt: now,
      },
    });
    const worker = await this.prisma.simulationEvaluatorWorker.upsert({
      where: { id: workerId },
      update: {
        publicKey,
        lastHeartbeatAt: now,
      },
      create: {
        id: workerId,
        publicKey,
        authorizationStatus:
          SimulationEvaluatorWorkerAuthorizationStatus.Pending,
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Online,
        lastHeartbeatAt: now,
      },
    });
    return worker.authorizationStatus;
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
        runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Online,
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
        lastHeartbeatAt: { lt: new Date(Date.now() - 90_000) },
      },
      data: { runtimeStatus: SimulationEvaluatorWorkerRuntimeStatus.Offline },
    });
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
}

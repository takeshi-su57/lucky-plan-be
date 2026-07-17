import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ChildProcess, fork } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import { join } from 'path';

import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';
import { SimulationEvaluatorWorkerClientService } from './simulation-evaluator-worker-client.service';
import { SimulationEvaluatorWorkerEvaluationService } from './simulation-evaluator-worker-evaluation.service';

type ClaimedTask = {
  id: string;
  kind: SimulationEvaluatorTaskKind;
  leaseToken: string;
};

@Injectable()
export class SimulationEvaluatorWorkerRuntimeService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  constructor(
    private readonly client: SimulationEvaluatorWorkerClientService,
    private readonly evaluator: SimulationEvaluatorWorkerEvaluationService,
  ) {}

  private heartbeat?: NodeJS.Timeout;
  private approved = false;
  private stopping = false;
  private heartbeatInFlight = false;
  private capacity = 1;
  private readonly sessionId = randomUUID();
  private readonly parentSessionPath = join(
    process.cwd(),
    ...SIMULATION_EVALUATOR.workerCacheDirectory,
    'parent-session.json',
  );
  private readonly children = new Set<ChildProcess>();
  private readonly idleChildren = new Set<ChildProcess>();
  private readonly running = new Map<string, ChildProcess>();

  onApplicationBootstrap() {
    void this.writeParentSessionHeartbeat();
    this.heartbeat = setInterval(
      () => void this.sendHeartbeat(),
      SIMULATION_EVALUATOR.heartbeatIntervalMs,
    );
    void this.run();
  }

  async onModuleDestroy() {
    this.stopping = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    await Promise.all([...this.children].map((child) => this.stopChild(child)));
    await this.removeParentSessionHeartbeat();
  }

  private async run() {
    while (!this.stopping) {
      try {
        if (!this.approved) {
          const enrollment = await this.client.joinHeartbeat();
          this.approved = enrollment.authorizationStatus === 'Approved';
          if (!this.approved) {
            await this.delay(SIMULATION_EVALUATOR.enrollmentRetryDelayMs);
            continue;
          }
          await this.ensureCapacity(this.capacity);
        }

        if (this.idleChildren.size === 0) {
          await this.delay(SIMULATION_EVALUATOR.pollDelayMs);
          continue;
        }
        const { task } = await this.client.poll();
        if (!task) {
          await this.delay(SIMULATION_EVALUATOR.pollDelayMs);
          continue;
        }
        void this.processTask(task);
      } catch (error) {
        console.error('[simulation-evaluator-worker]', error);
        await this.delay(SIMULATION_EVALUATOR.enrollmentRetryDelayMs);
      }
    }
  }

  private async processTask(task: ClaimedTask) {
    this.client.beginTask(task.id, task.leaseToken);
    try {
      const { input } = await this.client.getInput(task.id, task.leaseToken);
      let result: Record<string, unknown>;
      switch (task.kind) {
        case SimulationEvaluatorTaskKind.EvaluateLeaders:
          result = await this.evaluateInChild(task.id, input);
          break;
        case SimulationEvaluatorTaskKind.PrebuildPlatformCache:
          // Prebuild remains parent-only because it owns SQLite checkpoints and writes cache files.
          result = await this.evaluator.prebuildPlatformCache(
            task.id,
            task.leaseToken,
            input,
          );
          break;
        case SimulationEvaluatorTaskKind.SetWorkerCapacity: {
          const capacity = Number(input.capacity);
          if (
            !Number.isSafeInteger(capacity) ||
            capacity < 1 ||
            capacity > 64
          ) {
            throw new Error('Invalid worker capacity command');
          }
          await this.ensureCapacity(capacity);
          result = { activeCapacity: this.capacity };
          break;
        }
        default:
          throw new Error(
            `Unsupported simulation evaluator task kind: ${task.kind}`,
          );
      }
      await this.client.complete(task.id, task.leaseToken, result);
    } catch (error) {
      await this.client
        .fail(
          task.id,
          task.leaseToken,
          error instanceof Error ? error.message : String(error),
        )
        .catch(() => undefined);
      console.error('[simulation-evaluator-worker] task failed', error);
    } finally {
      this.client.endTask(task.id);
    }
  }

  private async ensureCapacity(capacity: number) {
    while (this.children.size < capacity) this.spawnChild();
    while (this.children.size > capacity && this.idleChildren.size > 0) {
      await this.stopChild(this.idleChildren.values().next().value!);
    }
    this.capacity = this.children.size;
  }

  private spawnChild() {
    const child = fork(this.getChildEntryPath(), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    this.children.add(child);
    this.idleChildren.add(child);
    child.send({ type: 'parent-session', sessionId: this.sessionId });
    child.on('exit', () => {
      this.children.delete(child);
      this.idleChildren.delete(child);
      for (const [taskId, active] of this.running)
        if (active === child) this.running.delete(taskId);
      this.capacity = this.children.size;
    });
  }

  private evaluateInChild(taskId: string, input: Record<string, unknown>) {
    const child = this.idleChildren.values().next().value as
      | ChildProcess
      | undefined;
    if (!child) throw new Error('No idle child evaluator is available');
    this.idleChildren.delete(child);
    this.running.set(taskId, child);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const cleanup = () => {
        child.off('message', onMessage);
        child.off('exit', onExit);
        this.running.delete(taskId);
        if (this.children.has(child)) this.idleChildren.add(child);
      };
      const onMessage = (message: {
        type?: string;
        taskId?: string;
        result?: Record<string, unknown>;
        error?: string;
      }) => {
        if (message.taskId !== taskId) return;
        cleanup();
        if (message.type === 'result' && message.result)
          resolve(message.result);
        else reject(new Error(message.error || 'Child evaluation failed'));
      };
      const onExit = () => {
        cleanup();
        reject(new Error('Child evaluator exited during evaluation'));
      };
      child.once('message', onMessage);
      child.once('exit', onExit);
      child.send({ type: 'evaluate', taskId, input });
    });
  }

  private async stopChild(child: ChildProcess) {
    this.idleChildren.delete(child);
    if (child.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const onExit = () => {
        clearTimeout(forceKillTimer);
        resolve();
      };
      const forceKillTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }, 5_000);

      child.once('exit', onExit);
      if (!child.killed) child.kill('SIGTERM');
    });
  }

  private getChildEntryPath() {
    const packagedEntry = process.env.SIMULATION_EVALUATOR_CHILD_ENTRY;
    if (packagedEntry && existsSync(packagedEntry)) return packagedEntry;
    return join(__dirname, 'simulation-evaluator-worker-child.js');
  }

  private async sendHeartbeat() {
    await this.writeParentSessionHeartbeat().catch((error) => {
      console.error(
        '[simulation-evaluator-worker] parent session heartbeat failed',
        error,
      );
    });
    if (this.heartbeatInFlight || !this.approved) return;
    this.heartbeatInFlight = true;
    try {
      await this.client.heartbeat();
    } catch (error) {
      console.error('[simulation-evaluator-worker] heartbeat failed', error);
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async writeParentSessionHeartbeat() {
    const temporaryPath = `${this.parentSessionPath}.${this.sessionId}.tmp`;
    await fs.mkdir(
      join(process.cwd(), ...SIMULATION_EVALUATOR.workerCacheDirectory),
      {
        recursive: true,
      },
    );
    await fs.writeFile(
      temporaryPath,
      JSON.stringify({
        sessionId: this.sessionId,
        pid: process.pid,
        updatedAt: Date.now(),
      }),
      'utf8',
    );
    await fs.rename(temporaryPath, this.parentSessionPath);
  }

  private async removeParentSessionHeartbeat() {
    try {
      const session = JSON.parse(
        await fs.readFile(this.parentSessionPath, 'utf8'),
      ) as { sessionId?: string };
      if (session.sessionId === this.sessionId)
        await fs.unlink(this.parentSessionPath);
    } catch {
      // The next parent session will replace a missing or stale heartbeat file.
    }
  }
}

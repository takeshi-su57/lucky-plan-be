import {
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ChildProcess, fork, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, promises as fs } from 'fs';
import { join } from 'path';

import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';
import { SimulationEvaluatorWorkerClientService } from './simulation-evaluator-worker-client.service';
import { WorkerDiagnosticSnapshot } from './simulation-evaluator-worker-client.service';
import { SimulationEvaluatorWorkerEvaluationService } from './simulation-evaluator-worker-evaluation.service';
import { simulationEvaluatorWorkerVersion } from './simulation-evaluator-worker-version';

type ClaimedTask = {
  id: string;
  kind: SimulationEvaluatorTaskKind;
  leaseToken: string;
};

export const evaluatorWorkerRestartExitCode = (platform: NodeJS.Platform) =>
  platform === 'win32' ? 1 : 0;

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
  private desiredChildCapacity = 1;
  private readonly sessionId = randomUUID();
  private readonly parentSessionPath = join(
    process.cwd(),
    ...SIMULATION_EVALUATOR.workerCacheDirectory,
    'parent-session.json',
  );
  private readonly children = new Set<ChildProcess>();
  private readonly idleChildren = new Set<ChildProcess>();
  private readonly running = new Map<string, ChildProcess>();
  private readonly pendingEvaluations: ClaimedTask[] = [];
  private readonly startingEvaluations = new Map<string, ChildProcess>();
  private readonly idleChildWaiters: Array<{
    resolve: (child: ChildProcess) => void;
    reject: (error: Error) => void;
  }> = [];
  private lastPollAt: Date | null = null;
  private lastPollError: string | null = null;
  private upgradeScheduled = false;
  private readonly recentLogs: {
    at: string;
    level: string;
    message: string;
  }[] = [];

  async onApplicationBootstrap() {
    void this.writeParentSessionHeartbeat();
    this.heartbeat = setInterval(
      () => void this.sendHeartbeat(),
      SIMULATION_EVALUATOR.heartbeatIntervalMs,
    );
    void this.finalizePendingUpgradeWithRetry();
    void this.run();
  }

  async onModuleDestroy() {
    this.stopping = true;
    for (const waiter of this.idleChildWaiters.splice(0))
      waiter.reject(new Error('Evaluator worker is stopping'));
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
          // Capacity is persisted by the gateway, while child processes are
          // local to this parent process. Rehydrate the local pool after a
          // service restart before accepting any evaluation work.
          await this.ensureCapacity(enrollment.desiredCapacity);
        }

        // Prebuild and capacity commands execute in the parent process. Do not
        // stop polling merely because child evaluators exited: doing so leaves
        // targeted prebuild commands Ready forever while the worker continues
        // to heartbeat as Free.
        const { task } = await this.client.poll();
        this.lastPollAt = new Date();
        this.lastPollError = null;
        if (!task) {
          await this.delay(SIMULATION_EVALUATOR.pollDelayMs);
          continue;
        }
        this.acceptTask(task);
      } catch (error) {
        this.lastPollError = this.describeError(error);
        this.log('error', `Poll/runtime error: ${this.lastPollError}`);
        await this.delay(SIMULATION_EVALUATOR.enrollmentRetryDelayMs);
      }
    }
  }

  private acceptTask(task: ClaimedTask) {
    // Register a lease as soon as it is claimed, including while it waits in
    // the local prefetch buffer, so heartbeat renewal covers queued work.
    this.client.beginTask(task.id, task.leaseToken);
    if (task.kind === SimulationEvaluatorTaskKind.EvaluateLeaders) {
      this.pendingEvaluations.push(task);
      this.drainPendingEvaluations();
      return;
    }
    void this.processTask(task);
  }

  private drainPendingEvaluations() {
    while (this.pendingEvaluations.length > 0 && this.idleChildren.size > 0) {
      const task = this.pendingEvaluations.shift()!;
      const child = this.takeIdleChild()!;
      this.startingEvaluations.set(task.id, child);
      void this.processTask(task);
    }
  }

  private async processTask(task: ClaimedTask) {
    const taskStartedAt = performance.now();
    try {
      const inputStartedAt = performance.now();
      const { input } = await this.client.getInput(task.id, task.leaseToken);
      const inputMs = Math.round(performance.now() - inputStartedAt);
      const executionStartedAt = performance.now();
      let result: Record<string, unknown>;
      switch (task.kind) {
        case SimulationEvaluatorTaskKind.EvaluateLeaders:
          result = await this.evaluateInChild(
            task.id,
            task.leaseToken,
            input,
            await this.acquireEvaluationChild(task.id),
          );
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
        case SimulationEvaluatorTaskKind.UpgradeWorker: {
          const version = String(input.version || '');
          const releaseUrl = String(input.releaseUrl || '');
          if (!this.isNewerVersion(version, this.workerVersion())) {
            result = {
              status: 'skipped',
              currentVersion: this.workerVersion(),
              version,
            };
            break;
          }
          await this.prepareSelfUpgrade(task, version, releaseUrl);
          result = {
            status: 'scheduled',
            currentVersion: this.workerVersion(),
            version,
          };
          break;
        }
        default:
          throw new Error(
            `Unsupported simulation evaluator task kind: ${task.kind}`,
          );
      }
      const executionMs = Math.round(performance.now() - executionStartedAt);
      const completionStartedAt = performance.now();
      const restartingForUpgrade =
        task.kind === SimulationEvaluatorTaskKind.UpgradeWorker &&
        result.status === 'scheduled';
      if (!restartingForUpgrade)
        await this.client.complete(task.id, task.leaseToken, result);
      if (
        task.kind === SimulationEvaluatorTaskKind.UpgradeWorker &&
        result.status === 'scheduled'
      ) {
        await this.flushUpgradeProgress();
        this.log(
          'info',
          `Upgrade to ${String(result.version)} scheduled; stopping for replacement`,
        );
        setTimeout(
          () => process.exit(evaluatorWorkerRestartExitCode(process.platform)),
          500,
        ).unref();
      }
      const completionMs = Math.round(performance.now() - completionStartedAt);
      const timing = result.timing as Record<string, unknown> | undefined;
      this.log(
        'info',
        `Task ${task.id} ${restartingForUpgrade ? 'prepared for restart' : 'completed'} totalMs=${Math.round(performance.now() - taskStartedAt)} inputMs=${inputMs} executionMs=${executionMs} completeMs=${completionMs}${timing ? ` evaluationTiming=${JSON.stringify(timing)}` : ''}`,
      );
    } catch (error) {
      await this.client
        .fail(task.id, task.leaseToken, this.describeTaskError(task, error))
        .catch(() => undefined);
      this.log('error', `Task ${task.id} failed: ${this.describeError(error)}`);
    } finally {
      this.releaseStartingChild(task.id);
      if (
        task.kind !== SimulationEvaluatorTaskKind.UpgradeWorker ||
        !this.upgradeScheduled
      ) {
        this.client.endTask(task.id);
      }
      this.drainPendingEvaluations();
    }
  }

  private async ensureCapacity(capacity: number) {
    this.desiredChildCapacity = capacity;
    while (this.children.size < capacity) this.spawnChild();
    while (this.children.size > capacity && this.idleChildren.size > 0) {
      await this.stopChild(this.idleChildren.values().next().value!);
    }
    this.capacity = this.children.size;
  }

  private workerVersion() {
    return simulationEvaluatorWorkerVersion();
  }

  private isNewerVersion(target: string, current: string) {
    const parse = (value: string) => {
      const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
      return match
        ? ([
            Number(match[1]),
            Number(match[2]),
            Number(match[3]),
            match[4] || '',
          ] as [number, number, number, string])
        : null;
    };
    const next = parse(target);
    const installed = parse(current);
    if (!next || !installed) return false;
    for (let index = 0; index < 3; index += 1) {
      if (next[index]! !== installed[index]!)
        return next[index]! > installed[index]!;
    }
    // A stable release supersedes its prerelease; other prerelease ordering is
    // deliberately not accepted automatically.
    return Boolean(!next[3] && installed[3]);
  }

  private async prepareSelfUpgrade(
    task: ClaimedTask,
    version: string,
    releaseUrl: string,
  ) {
    if (this.upgradeScheduled)
      throw new Error('An upgrade is already scheduled');
    const script = join(
      process.cwd(),
      'scripts',
      'evaluator-worker-self-update.js',
    );
    if (!existsSync(script)) {
      throw new Error('This worker release does not support self-upgrade');
    }
    let url: URL;
    try {
      url = new URL(releaseUrl);
    } catch {
      throw new Error('Invalid worker release URL');
    }
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      !url.pathname.startsWith('/takeshi-su57/lucky-plan-be/releases/download/')
    ) {
      throw new Error('Worker release URL is not an approved GitHub release');
    }
    this.client.reportTaskProgress(task.id, task.leaseToken, {
      progressPercent: 10,
      progressRecords: 0,
      progressTotalRecords: 1,
      progressBytes: 0,
      progressMessage: `Downloading evaluator worker ${version}`,
    });
    const child = spawn(
      process.execPath,
      [
        script,
        '--task-id',
        task.id,
        '--lease-token',
        task.leaseToken,
        '--version',
        version,
        '--url',
        url.toString(),
        '--checksum-url',
        `${url.toString()}.sha256`,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split('\n');
      stdout = lines.pop() || '';
      for (const line of lines) {
        try {
          const progress = JSON.parse(line) as {
            percent?: number;
            bytes?: number;
            totalBytes?: number;
            message?: string;
          };
          if (
            typeof progress.percent !== 'number' ||
            typeof progress.message !== 'string'
          )
            continue;
          this.client.reportTaskProgress(task.id, task.leaseToken, {
            progressPercent: Math.min(89, Math.max(10, progress.percent)),
            progressRecords: 0,
            progressTotalRecords: 0,
            progressBytes: Math.max(0, progress.bytes || 0),
            progressMessage: progress.message.slice(0, 500),
          });
        } catch {
          // Ignore non-JSON diagnostic output from platform extraction tools.
        }
      }
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-2_000);
    });
    await new Promise<void>((resolvePromise, reject) => {
      child.once('error', reject);
      child.once('exit', (code) =>
        code === 0
          ? resolvePromise()
          : reject(
              new Error(
                `Upgrade preparation exited with ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`,
              ),
            ),
      );
    });
    this.upgradeScheduled = true;
    this.client.reportTaskProgress(task.id, task.leaseToken, {
      progressPercent: 90,
      progressRecords: 1,
      progressTotalRecords: 1,
      progressBytes: 0,
      progressMessage: `Verified ${version}; restarting to apply update`,
    });
  }

  private async flushUpgradeProgress() {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.client.heartbeat(this.getDiagnosticSnapshot());
        return;
      } catch (error) {
        this.log(
          'error',
          `Could not flush upgrade progress (attempt ${attempt}/3): ${this.describeError(error)}`,
        );
        if (attempt < 3)
          await this.delay(SIMULATION_EVALUATOR.heartbeatIntervalMs);
      }
    }
    this.log(
      'error',
      'Continuing update restart without a final progress acknowledgement',
    );
  }

  private async finalizePendingUpgradeWithRetry() {
    const resultPath = join(
      process.cwd(),
      ...SIMULATION_EVALUATOR.workerCacheDirectory,
      'update-result.json',
    );
    let result: {
      taskId?: string;
      leaseToken?: string;
      version?: string;
      status?: string;
      error?: string;
    };
    try {
      result = JSON.parse(await fs.readFile(resultPath, 'utf8')) as {
        taskId?: string;
        leaseToken?: string;
        version?: string;
        status?: string;
        error?: string;
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.log(
          'error',
          `Could not read update result: ${this.describeError(error)}`,
        );
      return;
    }
    if (!result.taskId || !result.leaseToken) return;
    this.client.beginTask(result.taskId, result.leaseToken);
    this.client.reportTaskProgress(result.taskId, result.leaseToken, {
      progressPercent: 95,
      progressRecords: 1,
      progressTotalRecords: 1,
      progressBytes: 0,
      progressMessage:
        result.status === 'applied'
          ? `Evaluator worker ${result.version || 'unknown'} started; confirming upgrade`
          : 'Update apply failed; reporting rollback',
    });
    while (!this.stopping) {
      try {
        if (
          result.status === 'applied' &&
          result.version === this.workerVersion()
        ) {
          await this.client.complete(result.taskId, result.leaseToken, {
            status: 'completed',
            version: result.version,
          });
        } else {
          await this.client.fail(
            result.taskId,
            result.leaseToken,
            result.error ||
              `Upgrade to ${result.version || 'unknown'} did not apply`,
          );
        }
        await fs.unlink(resultPath);
        this.client.endTask(result.taskId);
        this.log(
          'info',
          `Upgrade task ${result.taskId} finalized as ${result.status}`,
        );
        return;
      } catch (error) {
        const detail = this.describeError(error);
        if (detail.includes('409')) {
          await fs.unlink(resultPath).catch(() => undefined);
          this.client.endTask(result.taskId);
          this.log(
            'error',
            `Upgrade task ${result.taskId} could not be finalized because its lease expired`,
          );
          return;
        }
        this.log('error', `Could not finalize update; retrying: ${detail}`);
        await this.delay(SIMULATION_EVALUATOR.heartbeatIntervalMs);
      }
    }
  }

  private spawnChild() {
    const child = fork(this.getChildEntryPath(), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    this.children.add(child);
    this.offerIdleChild(child);
    child.send({ type: 'parent-session', sessionId: this.sessionId });
    child.on('exit', () => {
      this.children.delete(child);
      this.idleChildren.delete(child);
      for (const [taskId, active] of this.running)
        if (active === child) this.running.delete(taskId);
      this.capacity = this.children.size;
      // A child may exit after startup because of a transient dependency or
      // platform error. Keep the advertised worker capacity recoverable
      // instead of permanently reducing the pool to zero.
      if (!this.stopping && this.children.size < this.desiredChildCapacity) {
        this.spawnChild();
      }
      this.drainPendingEvaluations();
    });
  }

  private evaluateInChild(
    taskId: string,
    leaseToken: string,
    input: Record<string, unknown>,
    child: ChildProcess,
  ): Promise<Record<string, unknown>> {
    if (!this.isUsableChild(child)) {
      return this.waitForIdleChild().then((replacement) =>
        this.evaluateInChild(taskId, leaseToken, input, replacement),
      );
    }
    this.running.set(taskId, child);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const cleanup = () => {
        child.off('message', onMessage);
        child.off('exit', onExit);
        this.running.delete(taskId);
        this.offerIdleChild(child);
      };
      const onMessage = (message: {
        type?: string;
        taskId?: string;
        result?: Record<string, unknown>;
        error?: string;
        completedCandidates?: number;
        totalCandidates?: number;
        eventLogRecords?: number;
        progressMessage?: string;
      }) => {
        if (message.taskId !== taskId) return;
        if (message.type === 'progress') {
          const completedCandidates = Math.max(
            0,
            message.completedCandidates || 0,
          );
          const totalCandidates = Math.max(0, message.totalCandidates || 0);
          this.client.reportTaskProgress(taskId, leaseToken, {
            progressPercent: totalCandidates
              ? Math.min(100, (completedCandidates / totalCandidates) * 100)
              : 100,
            progressRecords: completedCandidates,
            progressTotalRecords: totalCandidates,
            // The child reads local cache files, not a byte stream. Keep this
            // at zero instead of incorrectly presenting record count as bytes.
            progressBytes: 0,
            progressMessage:
              message.progressMessage ||
              `Evaluated ${completedCandidates} of ${totalCandidates} leaders`,
          });
          return;
        }
        cleanup();
        if (message.type === 'result' && message.result)
          resolve(message.result);
        else reject(new Error(message.error || 'Child evaluation failed'));
      };
      const onExit = () => {
        cleanup();
        reject(new Error('Child evaluator exited during evaluation'));
      };
      // Evaluation children emit progress before their terminal result, so the
      // listener must remain attached until cleanup handles that result.
      child.on('message', onMessage);
      child.once('exit', onExit);
      try {
        child.send({ type: 'evaluate', taskId, input });
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  private acquireEvaluationChild(taskId: string) {
    const reserved = this.startingEvaluations.get(taskId);
    this.startingEvaluations.delete(taskId);
    if (reserved && this.isUsableChild(reserved))
      return Promise.resolve(reserved);
    return this.waitForIdleChild();
  }

  private releaseStartingChild(taskId: string) {
    const child = this.startingEvaluations.get(taskId);
    this.startingEvaluations.delete(taskId);
    if (child) this.offerIdleChild(child);
  }

  private takeIdleChild() {
    const child = this.idleChildren.values().next().value as
      | ChildProcess
      | undefined;
    if (child) this.idleChildren.delete(child);
    return child;
  }

  private offerIdleChild(child: ChildProcess) {
    if (!this.isUsableChild(child)) return;
    const waiter = this.idleChildWaiters.shift();
    if (waiter) waiter.resolve(child);
    else this.idleChildren.add(child);
  }

  private waitForIdleChild() {
    const child = this.takeIdleChild();
    if (child) return Promise.resolve(child);
    if (this.stopping)
      return Promise.reject(new Error('Evaluator worker is stopping'));
    return new Promise<ChildProcess>((resolve, reject) => {
      this.idleChildWaiters.push({ resolve, reject });
    });
  }

  private isUsableChild(child: ChildProcess) {
    return (
      this.children.has(child) && child.exitCode === null && child.connected
    );
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
      await this.client.heartbeat(this.getDiagnosticSnapshot());
    } catch (error) {
      this.log('error', `Heartbeat failed: ${this.describeError(error)}`);
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private describeTaskError(task: ClaimedTask, error: unknown) {
    const detail = this.describeError(error);
    return `Task ${task.id} (${task.kind}) failed: ${detail}`;
  }

  private describeError(error: unknown) {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      1_000,
    );
  }

  private log(level: string, message: string) {
    this.recentLogs.push({ at: new Date().toISOString(), level, message });
    if (this.recentLogs.length > 50)
      this.recentLogs.splice(0, this.recentLogs.length - 50);
    console[level === 'error' ? 'error' : 'log'](
      '[simulation-evaluator-worker]',
      message,
    );
  }

  private getDiagnosticSnapshot(): WorkerDiagnosticSnapshot {
    return {
      pid: process.pid,
      uptimeSeconds: Math.floor(process.uptime()),
      childCapacity: this.desiredChildCapacity,
      childCount: this.children.size,
      idleChildCount: this.idleChildren.size,
      runningTaskCount: this.running.size,
      lastPollAt: this.lastPollAt?.toISOString() || null,
      lastPollError: this.lastPollError,
      recentLogs: this.recentLogs,
    };
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

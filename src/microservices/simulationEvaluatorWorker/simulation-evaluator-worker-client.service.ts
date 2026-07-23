import { Injectable } from '@nestjs/common';
import { randomUUID, sign } from 'crypto';
import { gunzipSync } from 'zlib';
import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';

import {
  SimulationEvaluatorWorkerCacheService,
  WorkerCachedEventLog,
} from './simulation-evaluator-worker-cache.service';
import { simulationEvaluatorWorkerVersion } from './simulation-evaluator-worker-version';

export type ClaimedEvaluatorTask = {
  id: string;
  kind: SimulationEvaluatorTaskKind;
  simulationId: number;
  simulationPlanId: number | null;
  rangeStartedAt: string;
  rangeEndedAt: string;
  inputChecksum: string;
  leaseToken: string;
  leaseExpiresAt: string;
};

type TaskProgressEvent = {
  id: string;
  type: 'task-progress';
  taskId: string;
  leaseToken: string;
  progressPercent: number;
  progressRecords: number;
  progressTotalRecords: number;
  progressBytes: number;
  progressMessage: string;
};

type TaskHeartbeatEvent = {
  id: string;
  type: 'task-heartbeat';
  taskId: string;
  leaseToken: string;
};

type WorkerHeartbeatEvent = TaskProgressEvent | TaskHeartbeatEvent;

export type WorkerDiagnosticSnapshot = {
  pid: number;
  uptimeSeconds: number;
  childCapacity: number;
  childCount: number;
  idleChildCount: number;
  runningTaskCount: number;
  lastPollAt: string | null;
  lastPollError: string | null;
  recentLogs: { at: string; level: string; message: string }[];
};

@Injectable()
export class SimulationEvaluatorWorkerClientService {
  constructor(private readonly cache: SimulationEvaluatorWorkerCacheService) {}
  private readonly pendingHeartbeatEvents = new Map<
    string,
    WorkerHeartbeatEvent
  >();
  private readonly activeTasks = new Map<string, string>();

  async joinHeartbeat() {
    const identity = this.cache.getWorkerIdentity();
    const response = await this.unsignedRequest(
      `${SIMULATION_EVALUATOR.gateway.basePath}${SIMULATION_EVALUATOR.gateway.heartbeat}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          workerId: identity.workerId,
          displayName: identity.displayName,
          publicKey: identity.publicKey,
          version: simulationEvaluatorWorkerVersion(),
        }),
      },
    );
    return (await response.json()) as {
      authorizationStatus: string;
      desiredCapacity: number;
    };
  }

  async heartbeat(diagnostic?: WorkerDiagnosticSnapshot) {
    const events = [
      ...[...this.activeTasks.entries()].map(([taskId, leaseToken]) => ({
        id: randomUUID(),
        type: 'task-heartbeat' as const,
        taskId,
        leaseToken,
      })),
      ...this.pendingHeartbeatEvents.values(),
    ];
    const queuedEvents = new Map(
      events
        .filter((event) => event.type === 'task-progress')
        .map((event) => [event.id, event]),
    );
    const response = await this.request(
      `${SIMULATION_EVALUATOR.gateway.basePath}${SIMULATION_EVALUATOR.gateway.heartbeat}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          events,
          diagnostic,
          version: simulationEvaluatorWorkerVersion(),
        }),
      },
    );
    const result = (await response.json()) as { acceptedEventIds: string[] };
    for (const id of result.acceptedEventIds) {
      const sent = queuedEvents.get(id);
      if (sent && this.pendingHeartbeatEvents.get(id) === sent) {
        this.pendingHeartbeatEvents.delete(id);
      }
    }
  }

  reportTaskProgress(
    taskId: string,
    leaseToken: string,
    progress: {
      progressPercent: number;
      progressRecords: number;
      progressTotalRecords: number;
      progressBytes: number;
      progressMessage: string;
    },
  ) {
    const existing = [...this.pendingHeartbeatEvents.values()].find(
      (event) => event.type === 'task-progress' && event.taskId === taskId,
    );
    const event: TaskProgressEvent = {
      id: existing?.id || randomUUID(),
      type: 'task-progress',
      taskId,
      leaseToken,
      ...progress,
    };
    this.pendingHeartbeatEvents.set(event.id, event);
  }

  beginTask(taskId: string, leaseToken: string) {
    this.activeTasks.set(taskId, leaseToken);
  }

  endTask(taskId: string) {
    this.activeTasks.delete(taskId);
    for (const [id, event] of this.pendingHeartbeatEvents) {
      if (event.taskId === taskId) this.pendingHeartbeatEvents.delete(id);
    }
  }

  async poll() {
    const response = await this.request(
      `${SIMULATION_EVALUATOR.gateway.basePath}${SIMULATION_EVALUATOR.gateway.poll}`,
      {
        method: 'POST',
      },
    );

    return (await response.json()) as { task: ClaimedEvaluatorTask | null };
  }

  async getInput(taskId: string, leaseToken: string) {
    const response = await this.request(
      `${SIMULATION_EVALUATOR.gateway.task(taskId)}/input`,
      {
        headers: { 'x-simulation-task-lease': leaseToken },
      },
    );

    return (await response.json()) as { input: Record<string, unknown> };
  }

  async getPrebuildChunk(
    taskId: string,
    leaseToken: string,
    cursor?: {
      date: string;
      block: number;
      logIndex: number;
      contractId: number;
    } | null,
  ) {
    const response = await this.request(
      `${SIMULATION_EVALUATOR.gateway.task(taskId)}/prebuild-chunk`,
      {
        headers: {
          'x-simulation-task-lease': leaseToken,
          ...(cursor
            ? { 'x-simulation-prebuild-cursor': JSON.stringify(cursor) }
            : {}),
        },
      },
      SIMULATION_EVALUATOR.prebuildChunkRequestTimeoutMs,
    );
    const compressed = Buffer.from(await response.arrayBuffer());
    const chunk = JSON.parse(gunzipSync(compressed).toString('utf8')) as {
      eventLogs: WorkerCachedEventLog[];
      nextCursor: {
        date: string;
        block: number;
        logIndex: number;
        contractId: number;
      } | null;
      done: boolean;
      totalRecords?: number;
    };
    return { ...chunk, compressedBytes: compressed.length };
  }

  async getEventLogs(input: {
    taskId: string;
    leaseToken: string;
    addresses: string[];
    startedAt: Date;
    endedAt: Date;
    cursor?: {
      date: string;
      block: number;
      logIndex: number;
      contractId: number;
    } | null;
  }) {
    const response = await this.request(
      `${SIMULATION_EVALUATOR.gateway.task(input.taskId)}/event-logs`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          leaseToken: input.leaseToken,
          addresses: input.addresses,
          startedAt: input.startedAt.toISOString(),
          endedAt: input.endedAt.toISOString(),
          cursor: input.cursor,
        }),
      },
    );

    return (await response.json()) as {
      eventLogs: WorkerCachedEventLog[];
      nextCursor: {
        date: string;
        block: number;
        logIndex: number;
        contractId: number;
      } | null;
      done: boolean;
    };
  }

  async complete(
    taskId: string,
    leaseToken: string,
    result: Record<string, unknown>,
  ) {
    await this.request(
      `${SIMULATION_EVALUATOR.gateway.task(taskId)}/complete`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leaseToken, result }),
      },
    );
  }

  async fail(taskId: string, leaseToken: string, error: string) {
    await this.request(`${SIMULATION_EVALUATOR.gateway.task(taskId)}/fail`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leaseToken, error }),
    });
  }

  private async request(
    path: string,
    init: RequestInit = {},
    timeoutMs: number = SIMULATION_EVALUATOR.gatewayRequestTimeoutMs,
  ) {
    const baseUrl = process.env.SIMULATION_EVALUATOR_GATEWAY_URL;

    if (!baseUrl) {
      throw new Error('SIMULATION_EVALUATOR_GATEWAY_URL is required');
    }

    const identity = this.cache.getWorkerIdentity();
    const timestamp = Date.now().toString();
    const requestId = randomUUID();
    const startedAt = performance.now();
    const method = (init.method || 'GET').toUpperCase();
    const message = `${identity.workerId}\n${timestamp}\n${method}\n${path}`;

    const signature = sign(
      null,
      Buffer.from(message),
      identity.privateKey,
    ).toString('base64');

    // A hung TCP request used to keep heartbeatInFlight true indefinitely.
    // Keep the timeout comfortably below the task lease so a later interval
    // can renew a long-running prebuild lease.
    let response: Response;
    try {
      response = await fetch(new URL(path, baseUrl), {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
        headers: {
          'x-simulation-worker-id': identity.workerId,
          'x-simulation-worker-timestamp': timestamp,
          'x-simulation-worker-signature': signature,
          'x-simulation-gateway-request-id': requestId,
          ...init.headers,
        },
      });
    } catch (error) {
      const detail = this.describeTransportError(error, timeoutMs, startedAt);
      throw new Error(
        `Worker gateway request failed: ${method} ${path} (${detail}; requestId=${requestId})`,
        { cause: error },
      );
    }

    if (!response.ok) {
      throw new Error(
        `Worker gateway request failed: ${response.status} ${await response.text()}`,
      );
    }

    return response;
  }

  private describeTransportError(
    error: unknown,
    timeoutMs: number,
    startedAt: number,
  ) {
    const elapsedMs = Math.round(performance.now() - startedAt);
    const source =
      error && typeof error === 'object' && 'cause' in error
        ? error.cause
        : undefined;
    const code =
      source && typeof source === 'object' && 'code' in source
        ? String(source.code)
        : undefined;
    const name = error instanceof Error ? error.name : 'UnknownError';
    const message = error instanceof Error ? error.message : String(error);
    const classification =
      name === 'TimeoutError' || name === 'AbortError'
        ? 'timeout'
        : code === 'ECONNREFUSED'
          ? 'connection-refused'
          : code === 'ECONNRESET'
            ? 'connection-reset'
            : code === 'ENOTFOUND'
              ? 'dns-not-found'
              : code === 'UND_ERR_CONNECT_TIMEOUT'
                ? 'connect-timeout'
                : 'network-fetch-failure';
    return [
      `classification=${classification}`,
      `elapsedMs=${elapsedMs}`,
      `timeoutMs=${timeoutMs}`,
      `error=${name}: ${message}`,
      ...(code ? [`code=${code}`] : []),
    ].join(', ');
  }

  private async unsignedRequest(path: string, init: RequestInit) {
    const baseUrl = process.env.SIMULATION_EVALUATOR_GATEWAY_URL;

    if (!baseUrl) {
      throw new Error('SIMULATION_EVALUATOR_GATEWAY_URL is required');
    }

    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      signal:
        init.signal ??
        AbortSignal.timeout(SIMULATION_EVALUATOR.gatewayRequestTimeoutMs),
    });

    if (!response.ok) {
      throw new Error(
        `Worker gateway request failed: ${response.status} ${await response.text()}`,
      );
    }

    return response;
  }
}

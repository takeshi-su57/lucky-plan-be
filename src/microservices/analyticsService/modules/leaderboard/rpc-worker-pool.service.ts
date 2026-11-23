import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PublicClient } from 'viem';
import {
  RpcEndpoint,
  RpcEndpointProvider,
  RpcEndpointState,
  RpcEndpointTier,
} from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { getReadableError } from 'src/utils';
import { EvmChainsService } from 'src/web3/web3/evm-chains.service';
import { getRpcTokenInfo, maskRpcUrl } from 'src/web3/web3/rpc-providers';

import { ClassifiedRpcError, RpcErrorKind } from './rpc-error-classifier';

/** Permanent-looking errors in a row before an endpoint is auto-disabled. */
const AUTO_DISABLE_AFTER = 3;

/**
 * Concurrent requests allowed per provider plan, across all chains and
 * tokens. dRPC free keys share a per-IP limit, so 40 tokens from one server
 * must not all fire at once. Precedence: values saved from the dashboard
 * (Metadata row below) > RPC_GROUP_CONCURRENCY env > these defaults.
 * Env format: RPC_GROUP_CONCURRENCY="DRPC:Free=12,ALCHEMY:Free=2".
 */
const DEFAULT_GROUP_CONCURRENCY: Record<string, number> = {
  'DRPC:Free': 8,
};

/**
 * Requests started per second per provider plan. Measured 2026-11-23: dRPC
 * free sustains ~2-3 successful getLogs/s from one IP in total, no matter how
 * many tokens are used; anything faster just returns "free plan rate limit".
 * 0 means no rate limit. Env format: RPC_GROUP_RATE="DRPC:Free=2".
 */
const DEFAULT_GROUP_RATE_PER_SECOND: Record<string, number> = {
  'DRPC:Free': 2,
};

/** Shared cooldown after a group-wide 429, doubling up to this cap. */
const GROUP_COOLDOWN_BASE_MS = 1_000;
const GROUP_COOLDOWN_MAX_MS = 30_000;

function parseGroupNumbers(
  value: string | undefined,
  defaults: Record<string, number>,
  allowZero: boolean,
): Record<string, number> {
  const result = { ...defaults };

  for (const entry of (value ?? '').split(',')) {
    const [key, raw] = entry.split('=').map((part) => part.trim());
    const number = Number(raw);

    if (key && raw && (allowZero ? number >= 0 : number > 0)) {
      result[key] = number;
    }
  }

  return result;
}

export function parseGroupConcurrency(
  value: string | undefined,
): Record<string, number> {
  return parseGroupNumbers(value, DEFAULT_GROUP_CONCURRENCY, false);
}

export function parseGroupRate(
  value: string | undefined,
): Record<string, number> {
  return parseGroupNumbers(value, DEFAULT_GROUP_RATE_PER_SECOND, true);
}

/** Metadata key holding dashboard overrides as JSON, e.g. {"DRPC:Free":12}. */
export const RPC_GROUP_CONCURRENCY_METADATA_KEY = 'RPC_GROUP_CONCURRENCY';
/** Metadata key holding requests/second overrides, e.g. {"DRPC:Free":2}. */
export const RPC_GROUP_RATE_METADATA_KEY = 'RPC_GROUP_RATE_PER_SECOND';

export function parseGroupConcurrencyOverrides(
  value: string | null | undefined,
  allowZero = false,
): Record<string, number> {
  try {
    const parsed = JSON.parse(value ?? '{}') as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' &&
          (allowZero ? entry[1] >= 0 : entry[1] > 0),
      ),
    );
  } catch {
    return {};
  }
}

/** Metadata key: "true" makes the backfill use Paid-tier endpoints only. */
export const RPC_BACKFILL_PAID_ONLY_METADATA_KEY = 'RPC_BACKFILL_PAID_ONLY';

/** Upper bound on parallel slots per endpoint, whatever the DB says. */
export const MAX_ENDPOINT_CONCURRENCY = 64;

export type RpcRateGroupView = {
  key: string;
  inFlight: number;
  limit: number;
  /** Requests started per second; null = no rate limit. */
  ratePerSecond: number | null;
  /** Group-wide pause after the provider returned a rate-limit error. */
  cooldownUntil: number | null;
  rateLimitedCount: number;
};

export type PenaltyOptions = {
  basePenaltyMs: number;
  maxPenaltyMs: number;
};

export type RpcWorkerAssignment = {
  contractId: number;
  fromBlock: bigint;
  toBlock: bigint;
  startedAt: number;
};

export type RpcPoolWorker = {
  key: string;
  /**
   * Parallel slot index. An endpoint with concurrency N has N pool workers
   * (slots) sharing one client, so it can run N requests at once.
   */
  slot: number;
  /** Null for workers built from .env because the chain has no DB rows. */
  endpointId: number | null;
  chainId: number;
  provider: RpcEndpointProvider;
  tier: RpcEndpointTier;
  label: string | null;
  url: string;
  client: PublicClient;
  state: RpcEndpointState;
  stateReason: string | null;
  stateChangedAt: number | null;
  maxBlockRange: number | null;
  assignment: RpcWorkerAssignment | null;
  penaltyLevel: number;
  availableAt: number;
  successCount: number;
  failureCount: number;
  consecutivePermanentFailures: number;
  blocksProcessed: number;
  avgLatencyMs: number | null;
  lastErrorKind: RpcErrorKind | null;
  lastError: string | null;
  lastErrorAt: number | null;
  lastSuccessAt: number | null;
};

export type RpcWorkerRuntimeView = Omit<
  RpcPoolWorker,
  'client' | 'url' | 'assignment'
> & {
  maskedUrl: string;
  tokenId: string | null;
  tokenHint: string | null;
  assignment: {
    contractId: number;
    fromBlock: number;
    toBlock: number;
    startedAt: number;
  } | null;
};

const providerFromEnvName: Record<string, RpcEndpointProvider> = {
  drpc: RpcEndpointProvider.DRPC,
  alchemy: RpcEndpointProvider.ALCHEMY,
  public: RpcEndpointProvider.PUBLIC,
};

/**
 * One shared worker pool per chain. Every contract on a chain draws from the
 * same workers, so penalties and rate limits are shared instead of each
 * contract hammering the same endpoints with its own counters.
 */
@Injectable()
export class RpcWorkerPoolService {
  private readonly pools = new Map<number, RpcPoolWorker[]>();
  private readonly loading = new Map<number, Promise<void>>();
  private readonly baseGroupLimits = parseGroupConcurrency(
    process.env.RPC_GROUP_CONCURRENCY,
  );
  private groupLimits: Record<string, number> = { ...this.baseGroupLimits };
  private readonly baseGroupRates = parseGroupRate(process.env.RPC_GROUP_RATE);
  private groupRates: Record<string, number> = { ...this.baseGroupRates };
  private readonly groupInFlight = new Map<string, number>();
  private readonly groupNextStartAt = new Map<string, number>();
  private readonly groupCooldownLevel = new Map<string, number>();
  private readonly groupCooldownUntil = new Map<string, number>();
  private readonly groupRateLimited = new Map<string, number>();
  private paidOnly = false;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly evmChainsService: EvmChainsService,
    private readonly logger: LogsService,
  ) {}

  async ensureChain(chainId: number) {
    if (this.pools.has(chainId)) {
      return;
    }

    if (!this.loading.has(chainId)) {
      this.loading.set(
        chainId,
        Promise.all([this.loadGroupLimits(), this.syncChain(chainId)])
          .then(() => undefined)
          .finally(() => this.loading.delete(chainId)),
      );
    }

    await this.loading.get(chainId);
  }

  getWorkers(chainId: number): RpcPoolWorker[] {
    return this.pools.get(chainId) ?? [];
  }

  isAvailable(worker: RpcPoolWorker, now = Date.now()) {
    return (
      worker.state === RpcEndpointState.Active &&
      (!this.paidOnly || worker.tier === RpcEndpointTier.Paid) &&
      !worker.assignment &&
      worker.availableAt <= now &&
      this.hasGroupCapacity(worker, now)
    );
  }

  backfillSettings() {
    return { paidOnly: this.paidOnly };
  }

  rateGroups(): RpcRateGroupView[] {
    const now = Date.now();
    const keys = new Set([
      ...Object.keys(this.groupLimits),
      ...Object.keys(this.groupRates),
    ]);

    return Array.from(keys).map((key) => {
      const cooldownUntil = this.groupCooldownUntil.get(key) ?? 0;

      return {
        key,
        limit: this.groupLimits[key] ?? 0,
        inFlight: this.groupInFlight.get(key) ?? 0,
        ratePerSecond: this.groupRates[key] || null,
        cooldownUntil: cooldownUntil > now ? cooldownUntil : null,
        rateLimitedCount: this.groupRateLimited.get(key) ?? 0,
      };
    });
  }

  private async loadGroupLimits() {
    try {
      const [limits, rates, paidOnly] = await Promise.all([
        this.prismaService.metadata.findUnique({
          where: { key: RPC_GROUP_CONCURRENCY_METADATA_KEY },
        }),
        this.prismaService.metadata.findUnique({
          where: { key: RPC_GROUP_RATE_METADATA_KEY },
        }),
        this.prismaService.metadata.findUnique({
          where: { key: RPC_BACKFILL_PAID_ONLY_METADATA_KEY },
        }),
      ]);
      this.paidOnly = paidOnly?.value === 'true';
      this.groupLimits = {
        ...this.baseGroupLimits,
        ...parseGroupConcurrencyOverrides(limits?.value),
      };
      this.groupRates = {
        ...this.baseGroupRates,
        ...parseGroupConcurrencyOverrides(rates?.value, true),
      };
    } catch (err) {
      // Keep the previous limits; a DB hiccup must not stop the backfill.
      this.logger.log({
        severity: 'Error',
        summary: 'rpcWorkerPool>loadGroupLimits',
        details: getReadableError(err),
      });
    }
  }

  private groupKey(worker: RpcPoolWorker) {
    const key = `${worker.provider}:${worker.tier}`;
    return key in this.groupLimits || key in this.groupRates ? key : null;
  }

  private hasGroupCapacity(worker: RpcPoolWorker, now: number) {
    const key = this.groupKey(worker);

    if (!key) return true;

    const limit = this.groupLimits[key];

    return (
      (!limit || (this.groupInFlight.get(key) ?? 0) < limit) &&
      (this.groupNextStartAt.get(key) ?? 0) <= now &&
      (this.groupCooldownUntil.get(key) ?? 0) <= now
    );
  }

  private clearAssignment(worker: RpcPoolWorker) {
    if (!worker.assignment) return;

    worker.assignment = null;
    const key = this.groupKey(worker);

    if (key) {
      this.groupInFlight.set(
        key,
        Math.max((this.groupInFlight.get(key) ?? 1) - 1, 0),
      );
    }
  }

  /** Picks up DB changes (pause/resume/add/delete) for every loaded chain. */
  @Interval(30_000)
  async reloadAll() {
    await this.loadGroupLimits();
    await Promise.allSettled(
      Array.from(this.pools.keys()).map((chainId) => this.syncChain(chainId)),
    );
  }

  acquire(worker: RpcPoolWorker, assignment: RpcWorkerAssignment) {
    worker.assignment = assignment;
    const key = this.groupKey(worker);

    if (key) {
      this.groupInFlight.set(key, (this.groupInFlight.get(key) ?? 0) + 1);

      const rate = this.groupRates[key];

      if (rate > 0) {
        const now = Date.now();
        this.groupNextStartAt.set(
          key,
          Math.max(now, this.groupNextStartAt.get(key) ?? 0) + 1000 / rate,
        );
      }
    }
  }

  markSuccess(worker: RpcPoolWorker, blocks: number) {
    const latency = worker.assignment
      ? Date.now() - worker.assignment.startedAt
      : null;

    this.clearAssignment(worker);
    const key = this.groupKey(worker);

    if (key) {
      this.groupCooldownLevel.set(
        key,
        Math.max((this.groupCooldownLevel.get(key) ?? 0) - 1, 0),
      );
    }

    worker.successCount++;
    worker.blocksProcessed += blocks;
    worker.consecutivePermanentFailures = 0;
    worker.penaltyLevel = Math.max(worker.penaltyLevel - 1, 0);
    worker.lastSuccessAt = Date.now();

    if (latency !== null) {
      worker.avgLatencyMs =
        worker.avgLatencyMs === null
          ? latency
          : Math.round(worker.avgLatencyMs * 0.8 + latency * 0.2);
    }
  }

  /** Releases a worker whose task failed for reasons unrelated to the RPC. */
  releaseWithoutPenalty(worker: RpcPoolWorker) {
    this.clearAssignment(worker);
  }

  async markFailure(
    worker: RpcPoolWorker,
    error: ClassifiedRpcError,
    rangeBlocks: number,
    penalty: PenaltyOptions,
  ) {
    this.clearAssignment(worker);
    worker.failureCount++;
    worker.lastErrorKind = error.kind;
    worker.lastError = error.message;
    worker.lastErrorAt = Date.now();

    if (error.kind === 'range_limit') {
      worker.consecutivePermanentFailures = 0;
      await this.learnMaxBlockRange(worker, error, rangeBlocks);
      return;
    }

    const groupKey = this.groupKey(worker);

    if (error.kind === 'rate_limited' && groupKey) {
      // The limit is shared by the whole group (per IP/account), so pause the
      // group briefly instead of sidelining this one token for minutes.
      const level = (this.groupCooldownLevel.get(groupKey) ?? 0) + 1;
      this.groupCooldownLevel.set(groupKey, level);
      this.groupRateLimited.set(
        groupKey,
        (this.groupRateLimited.get(groupKey) ?? 0) + 1,
      );
      this.groupCooldownUntil.set(
        groupKey,
        Math.max(
          this.groupCooldownUntil.get(groupKey) ?? 0,
          Date.now() +
            Math.min(
              GROUP_COOLDOWN_BASE_MS * 2 ** (level - 1),
              GROUP_COOLDOWN_MAX_MS,
            ),
        ),
      );
      worker.consecutivePermanentFailures = 0;
      return;
    }

    if (error.kind === 'response_too_large') {
      // The range is at fault, not the worker; the caller splits it.
      worker.consecutivePermanentFailures = 0;
      return;
    }

    worker.consecutivePermanentFailures =
      error.kind === 'permanent' || error.kind === 'auth'
        ? worker.consecutivePermanentFailures + 1
        : 0;

    if (worker.consecutivePermanentFailures >= AUTO_DISABLE_AFTER) {
      await this.setState(
        worker,
        RpcEndpointState.Disabled,
        `Auto-disabled after ${AUTO_DISABLE_AFTER} ${error.kind === 'auth' ? 'rejected-key' : 'permanent'} errors: ${error.message}`.slice(
          0,
          500,
        ),
      );
      return;
    }

    worker.penaltyLevel += 1;
    worker.availableAt =
      Date.now() +
      Math.min(
        penalty.basePenaltyMs * 2 ** Math.max(worker.penaltyLevel - 1, 0),
        penalty.maxPenaltyMs,
      );
  }

  snapshot(): RpcWorkerRuntimeView[] {
    return Array.from(this.pools.values())
      .flat()
      .map(({ client: _client, url, assignment, ...worker }) => ({
        ...worker,
        maskedUrl: maskRpcUrl(url),
        tokenId: getRpcTokenInfo(url)?.tokenId ?? null,
        tokenHint: getRpcTokenInfo(url)?.tokenHint ?? null,
        assignment: assignment
          ? {
              contractId: assignment.contractId,
              fromBlock: Number(assignment.fromBlock),
              toBlock: Number(assignment.toBlock),
              startedAt: assignment.startedAt,
            }
          : null,
      }));
  }

  private async learnMaxBlockRange(
    worker: RpcPoolWorker,
    error: ClassifiedRpcError,
    rangeBlocks: number,
  ) {
    const next =
      error.suggestedMaxBlockRange ?? Math.max(Math.floor(rangeBlocks / 2), 1);

    if (worker.maxBlockRange !== null && worker.maxBlockRange <= next) {
      return;
    }

    this.siblings(worker).forEach((slot) => (slot.maxBlockRange = next));

    this.logger.log({
      severity: 'Info',
      summary: 'rpcWorkerPool>learnMaxBlockRange',
      details: `worker:${worker.key} chainId:${worker.chainId} maxBlockRange:${next}`,
    });

    if (worker.endpointId !== null) {
      await this.prismaService.rpcEndpoint
        .update({
          where: { id: worker.endpointId },
          data: { maxBlockRange: next },
        })
        .catch((err) => this.logPersistError(worker, err));
    }
  }

  private async setState(
    worker: RpcPoolWorker,
    state: RpcEndpointState,
    reason: string | null,
  ) {
    const changedAt = Date.now();
    this.siblings(worker).forEach((slot) => {
      slot.state = state;
      slot.stateReason = reason;
      slot.stateChangedAt = changedAt;
    });

    this.logger.log({
      severity: 'Warning',
      summary: 'rpcWorkerPool>setState',
      details: `worker:${worker.key} chainId:${worker.chainId} state:${state} ${reason ?? ''}`,
    });

    if (worker.endpointId !== null) {
      await this.prismaService.rpcEndpoint
        .update({
          where: { id: worker.endpointId },
          data: {
            state,
            stateReason: reason,
            stateChangedAt: new Date(changedAt),
          },
        })
        .catch((err) => this.logPersistError(worker, err));
    }
  }

  private logPersistError(worker: RpcPoolWorker, err: unknown) {
    this.logger.log({
      severity: 'Error',
      summary: 'rpcWorkerPool>persist',
      details: `worker:${worker.key} ${getReadableError(err)}`,
    });
  }

  private async syncChain(chainId: number) {
    const rows = await this.prismaService.rpcEndpoint.findMany({
      where: { chainId },
      orderBy: { id: 'asc' },
    });
    const current = this.pools.get(chainId) ?? [];

    if (rows.length === 0) {
      // No seeded endpoints yet: keep the legacy .env-based workers.
      if (current.length === 0 || current.some((w) => w.endpointId !== null)) {
        this.pools.set(chainId, this.createEnvWorkers(chainId));
      }
      return;
    }

    const byKey = new Map(current.map((worker) => [worker.key, worker]));

    this.pools.set(
      chainId,
      rows.flatMap((row) => {
        const slots = Math.min(
          Math.max(row.concurrency ?? 1, 1),
          MAX_ENDPOINT_CONCURRENCY,
        );
        let client: PublicClient | null = null;

        return Array.from({ length: slots }, (_, slot) => {
          const existing = byKey.get(this.slotKey(row.id, slot));

          if (!existing || existing.url !== row.url) {
            client ??=
              existing?.url === row.url
                ? existing.client
                : this.evmChainsService.createAggressiveClient(
                    row.chainId,
                    row.url,
                  );
            return this.createWorker(row, slot, client);
          }

          client ??= existing.client;

          // The DB is the source of truth for admin-controlled fields.
          existing.state = row.state;
          existing.stateReason = row.stateReason;
          existing.label = row.label;
          existing.tier = row.tier;
          existing.provider = row.provider;
          existing.maxBlockRange = row.maxBlockRange;

          const changedAt = row.stateChangedAt?.getTime() ?? null;

          if (changedAt !== existing.stateChangedAt) {
            existing.stateChangedAt = changedAt;

            if (row.state === RpcEndpointState.Active) {
              // Resumed by an admin: start from a clean slate.
              existing.consecutivePermanentFailures = 0;
              existing.penaltyLevel = 0;
              existing.availableAt = 0;
            }
          }

          return existing;
        });
      }),
    );
  }

  /** Slot 0 keeps the plain key so existing views and logs stay stable. */
  private slotKey(endpointId: number, slot: number) {
    return slot === 0 ? `db:${endpointId}` : `db:${endpointId}#${slot}`;
  }

  /** All parallel slots of the same endpoint (or just this worker). */
  private siblings(worker: RpcPoolWorker): RpcPoolWorker[] {
    if (worker.endpointId === null) return [worker];

    return this.getWorkers(worker.chainId).filter(
      (other) => other.endpointId === worker.endpointId,
    );
  }

  private createWorker(
    row: RpcEndpoint,
    slot: number,
    client: PublicClient,
  ): RpcPoolWorker {
    return this.newWorker({
      key: this.slotKey(row.id, slot),
      slot,
      endpointId: row.id,
      chainId: row.chainId,
      provider: row.provider,
      tier: row.tier,
      label: row.label,
      url: row.url,
      client,
      state: row.state,
      stateReason: row.stateReason,
      stateChangedAt: row.stateChangedAt?.getTime() ?? null,
      maxBlockRange: row.maxBlockRange,
    });
  }

  private createEnvWorkers(chainId: number): RpcPoolWorker[] {
    return this.evmChainsService
      .getAggressivePublicClients(chainId)
      .map((client) =>
        this.newWorker({
          key: client.id,
          slot: 0,
          endpointId: null,
          chainId,
          provider:
            providerFromEnvName[client.provider] ?? RpcEndpointProvider.CUSTOM,
          tier: RpcEndpointTier.Free,
          label: client.id,
          url: client.url,
          client: client.client,
          state: RpcEndpointState.Active,
          stateReason: null,
          stateChangedAt: null,
          maxBlockRange: client.maxBlockRange ?? null,
        }),
      );
  }

  private newWorker(
    base: Pick<
      RpcPoolWorker,
      | 'key'
      | 'slot'
      | 'endpointId'
      | 'chainId'
      | 'provider'
      | 'tier'
      | 'label'
      | 'url'
      | 'client'
      | 'state'
      | 'stateReason'
      | 'stateChangedAt'
      | 'maxBlockRange'
    >,
  ): RpcPoolWorker {
    return {
      ...base,
      assignment: null,
      penaltyLevel: 0,
      availableAt: 0,
      successCount: 0,
      failureCount: 0,
      consecutivePermanentFailures: 0,
      blocksProcessed: 0,
      avgLatencyMs: null,
      lastErrorKind: null,
      lastError: null,
      lastErrorAt: null,
      lastSuccessAt: null,
    };
  }
}

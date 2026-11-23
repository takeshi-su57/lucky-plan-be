import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout } from 'rxjs';
import { createPublicClient, http } from 'viem';
import {
  RpcEndpoint,
  RpcEndpointProvider,
  RpcEndpointState,
  RpcEndpointTier,
} from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { getReadableError } from 'src/utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import {
  FREE_PLAN_MAX_BLOCK_RANGE,
  getPrivateProviderUrl,
  getRpcTokenInfo,
  maskRpcUrl,
  redactRpcSecrets,
} from 'src/web3/web3/rpc-providers';
import {
  MAX_ENDPOINT_CONCURRENCY,
  parseGroupConcurrencyOverrides,
  RPC_BACKFILL_PAID_ONLY_METADATA_KEY,
  RPC_GROUP_CONCURRENCY_METADATA_KEY,
  RPC_GROUP_RATE_METADATA_KEY,
} from 'src/microservices/analyticsService/modules/leaderboard/rpc-worker-pool.service';
import type {
  RpcRateGroupView,
  RpcWorkerRuntimeView,
} from 'src/microservices/analyticsService/modules/leaderboard/rpc-worker-pool.service';
import { MAX_RANGE_SPAN } from 'src/microservices/analyticsService/modules/leaderboard/aggressive-range-queue';
import { classifyRpcError } from 'src/microservices/analyticsService/modules/leaderboard/rpc-error-classifier';
import type { AggressiveAdaptionView } from 'src/microservices/analyticsService/modules/leaderboard/leaderboard.service';

import {
  CreateRpcEndpointsInput,
  UpdateRpcEndpointInput,
} from './dto/rpc-endpoint.input';
import {
  RpcEndpointCheckResult,
  RpcWorker,
  RpcWorkerDashboard,
  RpcWorkerStatus,
} from './entities/rpc-worker.entity';

/** Parallel health checks; dRPC free keys share one per-IP rate limit. */
const CHECK_CONCURRENCY = 8;

type RuntimeSnapshot = {
  workers: RpcWorkerRuntimeView[];
  adaptions: AggressiveAdaptionView[];
  rateGroups: RpcRateGroupView[];
  settings?: { paidOnly: boolean };
};

type MergedRuntime = RpcWorkerRuntimeView & { activeSlots: number };

/** Folds an endpoint's parallel slots into one row for the dashboard. */
function mergeSlots(slots: RpcWorkerRuntimeView[]): MergedRuntime {
  const [first] = slots;
  const latestError = slots.reduce((latest, slot) =>
    (slot.lastErrorAt ?? 0) > (latest.lastErrorAt ?? 0) ? slot : latest,
  );
  const latencies = slots
    .map((slot) => slot.avgLatencyMs)
    .filter((value): value is number => value !== null);
  const sum = (pick: (slot: RpcWorkerRuntimeView) => number) =>
    slots.reduce((total, slot) => total + pick(slot), 0);

  return {
    ...first,
    key: first.endpointId !== null ? `db:${first.endpointId}` : first.key,
    assignment: slots.find((slot) => slot.assignment)?.assignment ?? null,
    activeSlots: slots.filter((slot) => slot.assignment).length,
    successCount: sum((slot) => slot.successCount),
    failureCount: sum((slot) => slot.failureCount),
    blocksProcessed: sum((slot) => slot.blocksProcessed),
    // Usable as soon as any slot is.
    penaltyLevel: Math.min(...slots.map((slot) => slot.penaltyLevel)),
    availableAt: Math.min(...slots.map((slot) => slot.availableAt)),
    avgLatencyMs: latencies.length
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null,
    lastErrorKind: latestError.lastErrorKind,
    lastError: latestError.lastError,
    lastErrorAt: latestError.lastErrorAt,
    lastSuccessAt:
      Math.max(0, ...slots.map((s) => s.lastSuccessAt ?? 0)) || null,
  };
}

const privateProviderKey: Partial<
  Record<RpcEndpointProvider, 'drpc' | 'alchemy'>
> = {
  [RpcEndpointProvider.DRPC]: 'drpc',
  [RpcEndpointProvider.ALCHEMY]: 'alchemy',
};

@Injectable()
export class RpcWorkersService {
  constructor(
    private readonly prismaService: PrismaService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
  ) {}

  async getDashboard(): Promise<RpcWorkerDashboard> {
    const [rows, runtime] = await Promise.all([
      this.prismaService.rpcEndpoint.findMany({
        orderBy: [{ chainId: 'asc' }, { id: 'asc' }],
      }),
      this.fetchRuntime(),
    ]);
    const now = Date.now();
    const slotsById = new Map<number, RpcWorkerRuntimeView[]>();
    for (const worker of runtime?.workers ?? []) {
      if (worker.endpointId === null) continue;
      slotsById.set(worker.endpointId, [
        ...(slotsById.get(worker.endpointId) ?? []),
        worker,
      ]);
    }
    const runtimeById = new Map(
      Array.from(slotsById.entries()).map(([id, slots]) => [
        id,
        mergeSlots(slots),
      ]),
    );

    const workers = rows.map((row) =>
      this.toWorker(row, runtimeById.get(row.id) ?? null, !!runtime, now),
    );

    // Workers built from .env because their chain has no DB rows yet.
    for (const worker of runtime?.workers ?? []) {
      if (worker.endpointId === null) {
        workers.push(
          this.fromRuntime(
            { ...worker, activeSlots: worker.assignment ? 1 : 0 },
            now,
          ),
        );
      }
    }

    return {
      workers,
      adaptions: runtime?.adaptions ?? [],
      rateGroups: runtime?.rateGroups ?? [],
      paidOnly: await this.getPaidOnly(),
      analyticsOnline: !!runtime,
      generatedAt: now,
    };
  }

  async setState(id: number, state: RpcEndpointState) {
    await this.prismaService.rpcEndpoint.update({
      where: { id },
      data: {
        state,
        stateReason:
          state === RpcEndpointState.Paused ? 'Paused by admin' : null,
        stateChangedAt: new Date(),
      },
    });
    await this.notifyReload();
    return true;
  }

  async createEndpoints(input: CreateRpcEndpointsInput) {
    if (input.chainIds.length === 0) {
      throw new BadRequestException('Select at least one chain');
    }

    const providerKey = privateProviderKey[input.provider];
    const token = input.token?.trim();
    const rawUrl = input.url?.trim();

    const targets = input.chainIds.map((chainId) => {
      if (providerKey) {
        if (!token) {
          throw new BadRequestException(`${input.provider} requires a token`);
        }

        const url = getPrivateProviderUrl(providerKey, chainId, token);

        if (!url) {
          throw new BadRequestException(
            `${input.provider} does not support chain ${chainId}`,
          );
        }

        return { chainId, url };
      }

      if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
        throw new BadRequestException('A http(s) URL is required');
      }

      return { chainId, url: rawUrl };
    });

    if (input.verify) {
      await Promise.all(
        targets.map(({ chainId, url }) => this.verifyEndpoint(chainId, url)),
      );
    }

    const maxBlockRange =
      input.maxBlockRange && input.maxBlockRange > 0
        ? input.maxBlockRange
        : input.tier === RpcEndpointTier.Free && providerKey
          ? (FREE_PLAN_MAX_BLOCK_RANGE[providerKey] ?? null)
          : null;

    const result = await this.prismaService.rpcEndpoint.createMany({
      data: targets.map(({ chainId, url }) => ({
        chainId,
        url,
        provider: input.provider,
        tier: input.tier,
        label: input.label?.trim() || null,
        maxBlockRange,
      })),
      skipDuplicates: true,
    });

    await this.notifyReload();
    return result.count;
  }

  async updateEndpoint(input: UpdateRpcEndpointInput) {
    await this.prismaService.rpcEndpoint.update({
      where: { id: input.id },
      data: {
        ...(input.label !== undefined
          ? { label: input.label?.trim() || null }
          : {}),
        ...(input.maxBlockRange !== undefined && input.maxBlockRange !== null
          ? {
              maxBlockRange:
                input.maxBlockRange > 0
                  ? this.validMaxBlockRange(input.maxBlockRange)
                  : null,
            }
          : {}),
        ...(input.tier ? { tier: input.tier } : {}),
        ...(input.concurrency
          ? { concurrency: this.validConcurrency(input.concurrency) }
          : {}),
      },
    });
    await this.notifyReload();
    return true;
  }

  /** Sets max block range and/or parallel requests on every chain of a token. */
  async updateToken(
    tokenId: string,
    settings: { maxBlockRange?: number | null; concurrency?: number | null },
  ) {
    const ids = await this.findTokenEndpointIds(tokenId);
    const result = await this.prismaService.rpcEndpoint.updateMany({
      where: { id: { in: ids } },
      data: {
        ...(settings.maxBlockRange !== undefined &&
        settings.maxBlockRange !== null
          ? {
              maxBlockRange:
                settings.maxBlockRange > 0
                  ? this.validMaxBlockRange(settings.maxBlockRange)
                  : null,
            }
          : {}),
        ...(settings.concurrency
          ? { concurrency: this.validConcurrency(settings.concurrency) }
          : {}),
      },
    });

    await this.notifyReload();
    return result.count;
  }

  async getPaidOnly() {
    const record = await this.prismaService.metadata.findUnique({
      where: { key: RPC_BACKFILL_PAID_ONLY_METADATA_KEY },
    });
    return record?.value === 'true';
  }

  /** Backfill uses only Paid-tier endpoints while on; endpoint states are untouched. */
  async setPaidOnly(enabled: boolean) {
    const value = enabled ? 'true' : 'false';
    await this.prismaService.metadata.upsert({
      where: { key: RPC_BACKFILL_PAID_ONLY_METADATA_KEY },
      create: { key: RPC_BACKFILL_PAID_ONLY_METADATA_KEY, value },
      update: { value },
    });
    await this.notifyReload();
    return enabled;
  }

  private validConcurrency(value: number) {
    if (
      !Number.isInteger(value) ||
      value < 1 ||
      value > MAX_ENDPOINT_CONCURRENCY
    ) {
      throw new BadRequestException(
        `Parallel requests must be a whole number from 1 to ${MAX_ENDPOINT_CONCURRENCY}`,
      );
    }
    return value;
  }

  private validMaxBlockRange(value: number) {
    if (!Number.isInteger(value) || value > Number(MAX_RANGE_SPAN)) {
      throw new BadRequestException(
        `Max block range must be a whole number up to ${MAX_RANGE_SPAN}`,
      );
    }
    return value;
  }

  /** Saves a shared concurrency cap; the analytics pool applies it on reload. */
  async setRateGroupLimit(
    key: string,
    limit: number,
    ratePerSecond?: number | null,
  ) {
    const providers = Object.values(RpcEndpointProvider) as string[];
    const tiers = Object.values(RpcEndpointTier) as string[];
    const [provider, tier] = key.split(':');

    if (!providers.includes(provider) || !tiers.includes(tier)) {
      throw new BadRequestException(
        `Group must look like PROVIDER:Tier, e.g. DRPC:Free`,
      );
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      throw new BadRequestException(
        'Limit must be a whole number from 1 to 500',
      );
    }

    if (
      ratePerSecond !== undefined &&
      ratePerSecond !== null &&
      !(ratePerSecond >= 0 && ratePerSecond <= 1000)
    ) {
      throw new BadRequestException(
        'Rate must be from 0 (no limit) to 1000 requests per second',
      );
    }

    await this.mergeGroupSetting(
      RPC_GROUP_CONCURRENCY_METADATA_KEY,
      key,
      limit,
    );

    if (ratePerSecond !== undefined && ratePerSecond !== null) {
      await this.mergeGroupSetting(
        RPC_GROUP_RATE_METADATA_KEY,
        key,
        ratePerSecond,
        true,
      );
    }

    await this.notifyReload();
    return true;
  }

  private async mergeGroupSetting(
    metadataKey: string,
    key: string,
    value: number,
    allowZero = false,
  ) {
    const record = await this.prismaService.metadata.findUnique({
      where: { key: metadataKey },
    });
    const json = JSON.stringify({
      ...parseGroupConcurrencyOverrides(record?.value, allowZero),
      [key]: value,
    });

    await this.prismaService.metadata.upsert({
      where: { key: metadataKey },
      create: { key: metadataKey, value: json },
      update: { value: json },
    });
  }

  async deleteEndpoint(id: number) {
    await this.prismaService.rpcEndpoint.delete({ where: { id } });
    await this.notifyReload();
    return true;
  }

  /**
   * Calls eth_blockNumber on the selected endpoints and stores the result, so
   * dead or expired tokens show up even when no backfill is running. Runs at
   * most CHECK_CONCURRENCY at once to stay under dRPC's shared per-IP limit.
   */
  async checkEndpoints(filter: {
    ids?: number[] | null;
    tokenId?: string | null;
    chainId?: number | null;
  }): Promise<RpcEndpointCheckResult[]> {
    const rows = (
      await this.prismaService.rpcEndpoint.findMany({
        where: {
          ...(filter.ids?.length ? { id: { in: filter.ids } } : {}),
          ...(filter.chainId ? { chainId: filter.chainId } : {}),
        },
        orderBy: { id: 'asc' },
      })
    ).filter(
      (row) =>
        !filter.tokenId || getRpcTokenInfo(row.url)?.tokenId === filter.tokenId,
    );

    const results: RpcEndpointCheckResult[] = [];
    let next = 0;

    const runNext = async (): Promise<void> => {
      const row = rows[next++];

      if (!row) return;

      results.push(await this.checkEndpoint(row));
      await runNext();
    };

    await Promise.all(
      Array.from({ length: Math.min(CHECK_CONCURRENCY, rows.length) }, runNext),
    );

    return results.sort((a, b) => a.endpointId - b.endpointId);
  }

  async setTokenState(tokenId: string, state: RpcEndpointState) {
    const ids = await this.findTokenEndpointIds(tokenId);
    const result = await this.prismaService.rpcEndpoint.updateMany({
      where: { id: { in: ids } },
      data: {
        state,
        stateReason:
          state === RpcEndpointState.Paused ? 'Token paused by admin' : null,
        stateChangedAt: new Date(),
      },
    });

    await this.notifyReload();
    return result.count;
  }

  async deleteToken(tokenId: string) {
    const ids = await this.findTokenEndpointIds(tokenId);
    const result = await this.prismaService.rpcEndpoint.deleteMany({
      where: { id: { in: ids } },
    });

    await this.notifyReload();
    return result.count;
  }

  /** Adds chains to an existing token without the client ever seeing it. */
  async addTokenChains(tokenId: string, chainIds: number[]) {
    const rows = await this.findTokenEndpoints(tokenId);
    const template = rows[0];
    const token = template ? getRpcTokenInfo(template.url) : null;

    if (!template || !token) {
      throw new BadRequestException('Unknown token');
    }

    const existing = new Set(rows.map((row) => row.chainId));
    const missing = chainIds.filter((chainId) => !existing.has(chainId));

    if (missing.length === 0) {
      return 0;
    }

    return await this.createEndpoints({
      provider: template.provider,
      tier: template.tier,
      chainIds: missing,
      token: token.token,
      url: null,
      label: template.label,
      maxBlockRange: null,
      verify: true,
    });
  }

  private async findTokenEndpoints(tokenId: string) {
    const rows = await this.prismaService.rpcEndpoint.findMany({
      where: {
        provider: {
          in: [RpcEndpointProvider.DRPC, RpcEndpointProvider.ALCHEMY],
        },
      },
    });

    return rows.filter((row) => getRpcTokenInfo(row.url)?.tokenId === tokenId);
  }

  private async findTokenEndpointIds(tokenId: string) {
    const ids = (await this.findTokenEndpoints(tokenId)).map((row) => row.id);

    if (ids.length === 0) {
      throw new BadRequestException('Unknown token');
    }

    return ids;
  }

  private async checkEndpoint(
    row: RpcEndpoint,
  ): Promise<RpcEndpointCheckResult> {
    const startedAt = Date.now();
    let result: RpcEndpointCheckResult;

    try {
      const client = createPublicClient({
        transport: http(row.url, { timeout: 10_000, retryCount: 0 }),
      });
      await client.getBlockNumber({ cacheTime: 0 });
      result = {
        endpointId: row.id,
        chainId: row.chainId,
        ok: true,
        latencyMs: Date.now() - startedAt,
        errorKind: null,
        error: null,
      };
    } catch (err) {
      const classified = classifyRpcError(err);
      result = {
        endpointId: row.id,
        chainId: row.chainId,
        ok: false,
        latencyMs: Date.now() - startedAt,
        errorKind: classified.kind,
        error: classified.message,
      };
    }

    await this.prismaService.rpcEndpoint.update({
      where: { id: row.id },
      data: {
        lastCheckedAt: new Date(),
        lastCheckOk: result.ok,
        lastCheckLatencyMs: result.latencyMs,
        lastCheckErrorKind: result.errorKind,
        lastCheckError: result.error,
      },
    });

    return result;
  }

  private async verifyEndpoint(chainId: number, url: string) {
    try {
      const client = createPublicClient({
        transport: http(url, { timeout: 10_000, retryCount: 0 }),
      });
      const actual = await client.getChainId();

      if (actual !== chainId) {
        throw new Error(`endpoint is on chain ${actual}, expected ${chainId}`);
      }
    } catch (err) {
      throw new BadRequestException(
        `Verification failed for ${maskRpcUrl(url)}: ${redactRpcSecrets(getReadableError(err)).slice(0, 300)}`,
      );
    }
  }

  private async fetchRuntime(): Promise<RuntimeSnapshot | null> {
    try {
      return await firstValueFrom(
        this.redisClient
          .send<RuntimeSnapshot>(PATTERNS.Leaderboard.GetRpcWorkers, {})
          .pipe(timeout(5_000)),
      );
    } catch {
      return null;
    }
  }

  /** Best effort: the analytics pool also re-syncs from the DB every 30s. */
  private async notifyReload() {
    try {
      await firstValueFrom(
        this.redisClient
          .send(PATTERNS.Leaderboard.ReloadRpcWorkers, {})
          .pipe(timeout(5_000)),
      );
    } catch {
      // Analytics offline; it will load the new state when it starts.
    }
  }

  private checkFields(row: RpcEndpoint | null) {
    return {
      lastCheckedAt: row?.lastCheckedAt?.getTime() ?? null,
      lastCheckOk: row?.lastCheckOk ?? null,
      lastCheckLatencyMs: row?.lastCheckLatencyMs ?? null,
      lastCheckErrorKind: row?.lastCheckErrorKind ?? null,
      lastCheckError: row?.lastCheckError ?? null,
    };
  }

  private toWorker(
    row: RpcEndpoint,
    runtime: MergedRuntime | null,
    analyticsOnline: boolean,
    now: number,
  ): RpcWorker {
    const token = getRpcTokenInfo(row.url);

    if (runtime) {
      // DB is authoritative for admin-controlled fields; it may be fresher.
      return this.fromRuntime(
        {
          ...runtime,
          state: row.state,
          stateReason: row.stateReason,
          label: row.label,
          tier: row.tier,
          maxBlockRange: row.maxBlockRange ?? runtime.maxBlockRange,
          tokenId: token?.tokenId ?? null,
          tokenHint: token?.tokenHint ?? null,
        },
        now,
        row,
      );
    }

    const status =
      row.state === RpcEndpointState.Paused
        ? RpcWorkerStatus.Paused
        : row.state === RpcEndpointState.Disabled
          ? RpcWorkerStatus.Disabled
          : analyticsOnline
            ? RpcWorkerStatus.Idle
            : RpcWorkerStatus.Unknown;

    return {
      key: `db:${row.id}`,
      endpointId: row.id,
      chainId: row.chainId,
      provider: row.provider,
      tier: row.tier,
      label: row.label,
      maskedUrl: maskRpcUrl(row.url),
      tokenId: token?.tokenId ?? null,
      tokenHint: token?.tokenHint ?? null,
      state: row.state,
      stateReason: row.stateReason,
      status,
      maxBlockRange: row.maxBlockRange,
      concurrency: row.concurrency,
      activeSlots: 0,
      penaltyLevel: 0,
      penaltyUntil: null,
      successCount: 0,
      failureCount: 0,
      blocksProcessed: 0,
      avgLatencyMs: null,
      lastErrorKind: null,
      lastError: null,
      lastErrorAt: null,
      lastSuccessAt: null,
      assignmentContractId: null,
      assignmentFromBlock: null,
      assignmentToBlock: null,
      assignmentStartedAt: null,
      ...this.checkFields(row),
    };
  }

  private fromRuntime(
    worker: MergedRuntime,
    now: number,
    row: RpcEndpoint | null = null,
  ): RpcWorker {
    const status =
      worker.activeSlots > 0
        ? RpcWorkerStatus.Working
        : worker.state === RpcEndpointState.Paused
          ? RpcWorkerStatus.Paused
          : worker.state === RpcEndpointState.Disabled
            ? RpcWorkerStatus.Disabled
            : worker.availableAt > now
              ? RpcWorkerStatus.Penalized
              : RpcWorkerStatus.Available;

    return {
      key: worker.key,
      endpointId: worker.endpointId,
      chainId: worker.chainId,
      provider: worker.provider,
      tier: worker.tier,
      label: worker.label,
      maskedUrl: worker.maskedUrl,
      tokenId: worker.tokenId,
      tokenHint: worker.tokenHint,
      state: worker.state,
      stateReason: worker.stateReason,
      status,
      maxBlockRange: worker.maxBlockRange,
      concurrency: row?.concurrency ?? 1,
      activeSlots: worker.activeSlots,
      penaltyLevel: worker.penaltyLevel,
      penaltyUntil: worker.availableAt > now ? worker.availableAt : null,
      successCount: worker.successCount,
      failureCount: worker.failureCount,
      blocksProcessed: worker.blocksProcessed,
      avgLatencyMs: worker.avgLatencyMs,
      lastErrorKind: worker.lastErrorKind,
      lastError: worker.lastError,
      lastErrorAt: worker.lastErrorAt,
      lastSuccessAt: worker.lastSuccessAt,
      assignmentContractId: worker.assignment?.contractId ?? null,
      assignmentFromBlock: worker.assignment?.fromBlock ?? null,
      assignmentToBlock: worker.assignment?.toBlock ?? null,
      assignmentStartedAt: worker.assignment?.startedAt ?? null,
      ...this.checkFields(row),
    };
  }
}

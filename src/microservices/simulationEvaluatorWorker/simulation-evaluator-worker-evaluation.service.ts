import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';

import { Platform } from 'generated/prisma/enums';
import { EventLogsService } from 'src/microservices/apiService/modules/trade-histories/event-logs.service';
import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';
import {
  CandidateEvaluation,
  ContractContext,
  SimulationLeaderEvaluatorService,
} from 'src/microservices/analyticsService/modules/simulations/simulation-leader-evaluator.service';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';
import { SimulationEvaluatorWorkerCacheService } from './simulation-evaluator-worker-cache.service';
import { SimulationEvaluatorWorkerClientService } from './simulation-evaluator-worker-client.service';

const CANDIDATE_RECENT_ACTIVITY_DAYS = 30;

type EvaluateLeadersTaskInput = {
  simulation: Simulation;
  candidateLeaders: string[];
  range: { startedAt: string; endedAt: string };
  contracts: ContractContext[];
  eventLogWindowStartedAt: string;
  eventLogWindowEndedAt: string;
  behavioralEvaluationStartedAt: string;
};

type PrebuildPlatformCacheTaskInput = {
  platform: Platform;
  eventLogWindowStartedAt: string;
  eventLogWindowEndedAt: string;
};

@Injectable()
export class SimulationEvaluatorWorkerEvaluationService {
  constructor(
    private readonly client: SimulationEvaluatorWorkerClientService,
    private readonly cache: SimulationEvaluatorWorkerCacheService,
  ) {}

  async evaluate(taskId: string, leaseToken: string, rawInput: unknown) {
    const input = this.parseEvaluateLeadersInput(rawInput);

    const startedAt = new Date(input.eventLogWindowStartedAt);
    const endedAt = new Date(input.eventLogWindowEndedAt);

    const recordsByAddress = await this.loadEventLogs(
      taskId,
      leaseToken,
      input,
      startedAt,
      endedAt,
    );

    const contractById = new Map(
      input.contracts.map((contract) => [contract.id, contract]),
    );

    const rangeStartedAt = new Date(input.range.startedAt);
    const behavioralEvaluationStartedAt = new Date(
      input.behavioralEvaluationStartedAt,
    );
    const recentActivityCutoff = dayjs(rangeStartedAt)
      .subtract(CANDIDATE_RECENT_ACTIVITY_DAYS, 'day')
      .toDate();

    const minimumTradeCount = Math.min(
      ...input.simulation.trade.map((range) => range.min),
    );

    const evaluations: CandidateEvaluation[] = [];

    for (const leaderAddress of input.candidateLeaders) {
      const records = recordsByAddress.get(leaderAddress.toLowerCase()) || [];

      const recentTradeCount = records.filter((record) => {
        const date = new Date(record.date);
        return date >= recentActivityCutoff && date < rangeStartedAt;
      }).length;

      if (recentTradeCount === 0 || recentTradeCount < minimumTradeCount) {
        continue;
      }

      const histories = SimulationLeaderEvaluatorService.eventLogsToHistories(
        records.map((record) => ({ ...record, date: new Date(record.date) })),
        contractById,
      );
      const allPositions = EventLogsService.buildPerpTradePositionsWithSummary(
        input.simulation.platform,
        histories,
        {},
      ).positions;
      const positions = EventLogsService.buildPerpTradePositionsWithSummary(
        input.simulation.platform,
        histories,
        {
          collateralRanges: input.simulation.collateral,
          sizeRanges: input.simulation.size,
          leverageRanges: input.simulation.leverage,
        },
      ).positions;
      const closedPositions =
        SimulationLeaderEvaluatorService.getClosedPositionsInRange(
          positions,
          behavioralEvaluationStartedAt,
          rangeStartedAt,
        );
      const evaluation =
        SimulationLeaderEvaluatorService.evaluateLeaderPositionsForSimulation(
          leaderAddress,
          closedPositions,
          input.simulation,
          {
            startedAt: behavioralEvaluationStartedAt,
            endedAt: rangeStartedAt,
          },
          SimulationLeaderEvaluatorService.getClosedPositionsInRange(
            allPositions,
            behavioralEvaluationStartedAt,
            rangeStartedAt,
          ),
        );
      if (
        evaluation.rejectedReason ||
        !input.simulation.score.some(
          (range) =>
            evaluation.score >= range.min && evaluation.score <= range.max,
        )
      ) {
        continue;
      }
      evaluations.push(evaluation);
    }

    return { evaluatedCandidates: evaluations };
  }

  async prebuildPlatformCache(
    taskId: string,
    leaseToken: string,
    rawInput: unknown,
  ) {
    const input = this.parsePrebuildPlatformCacheInput(rawInput);
    const platform = input.platform as Platform;
    const startedAt = new Date(String(input.eventLogWindowStartedAt));
    const endedAt = new Date(String(input.eventLogWindowEndedAt));

    if (
      !Object.values(Platform).includes(platform) ||
      Number.isNaN(+startedAt) ||
      Number.isNaN(+endedAt) ||
      startedAt >= endedAt
    ) {
      throw new Error('Invalid cache-prebuild input');
    }

    if (this.cache.hasPlatformCoverage(platform, startedAt, endedAt)) {
      this.cache.clearPrebuildTaskCheckpoint(taskId);
      return {
        platform,
        coveredStartAt: startedAt.toISOString(),
        coveredEndAt: endedAt.toISOString(),
      };
    }

    const checkpoint = this.cache.getPrebuildTaskCheckpoint(
      taskId,
      platform,
      startedAt,
      endedAt,
    );
    let cursor = checkpoint?.cursor ?? null;
    let recordsProcessed = checkpoint?.recordsProcessed ?? 0;
    let bytesDownloaded = checkpoint?.bytesDownloaded ?? 0;
    let totalRecords = checkpoint?.totalRecords ?? 0;
    let done = checkpoint?.done ?? false;

    while (!done) {
      let chunk;
      try {
        chunk = await this.client.getPrebuildChunk(taskId, leaseToken, cursor);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Cache prebuild failed while loading ${platform} logs for ${startedAt.toISOString()} to ${endedAt.toISOString()} at ${cursor ? `cursor ${JSON.stringify(cursor)}` : 'the initial chunk'}: ${detail}`,
          { cause: error },
        );
      }
      totalRecords = chunk.totalRecords ?? totalRecords;
      if (!chunk.done && !chunk.nextCursor) {
        throw new Error('Prebuild chunk is missing a next cursor');
      }
      this.validatePrebuildChunk(
        chunk.eventLogs,
        chunk.nextCursor,
        cursor,
        platform,
        startedAt,
        endedAt,
        chunk.done,
      );
      recordsProcessed += chunk.eventLogs.length;
      bytesDownloaded += chunk.compressedBytes;
      cursor = chunk.nextCursor;
      done = chunk.done;

      // Event logs are written before the cursor checkpoint. If the process
      // stops between those writes, replaying the last idempotent batch is
      // safe; advancing past data that was not persisted is not.
      const checkpoint = {
        cursor,
        done,
        recordsProcessed,
        bytesDownloaded,
        totalRecords,
      };
      if (this.cache.isSqliteEventLogCache()) {
        this.cache.commitSqlitePrebuildChunk({
          taskId,
          platform,
          startedAt,
          endedAt,
          eventLogs: chunk.eventLogs,
          checkpoint,
          completed: done,
        });
      } else {
        await this.cache.mergeEventLogs(chunk.eventLogs);
        this.cache.savePrebuildTaskCheckpoint(
          taskId,
          platform,
          startedAt,
          endedAt,
          checkpoint,
        );
      }
      const progressPercent = totalRecords
        ? Math.min(100, (recordsProcessed / totalRecords) * 100)
        : chunk.done
          ? 100
          : 0;

      this.client.reportTaskProgress(taskId, leaseToken, {
        progressPercent,
        progressRecords: recordsProcessed,
        progressTotalRecords: totalRecords,
        progressBytes: bytesDownloaded,
        progressMessage:
          totalRecords || chunk.done
            ? `Cached ${recordsProcessed.toLocaleString()} of ${totalRecords.toLocaleString()} event logs (${progressPercent.toFixed(1)}%)`
            : 'Checking event logs to cache',
      });
    }

    if (!this.cache.isSqliteEventLogCache()) {
      this.cache.markPlatformCoverage(platform, startedAt, endedAt);
      this.cache.clearPrebuildTaskCheckpoint(taskId);
    }

    return {
      platform,
      coveredStartAt: startedAt.toISOString(),
      coveredEndAt: endedAt.toISOString(),
      progressRecords: recordsProcessed,
      progressTotalRecords: totalRecords,
      progressPercent: 100,
      progressBytes: bytesDownloaded,
    };
  }

  private async loadEventLogs(
    taskId: string,
    leaseToken: string,
    input: EvaluateLeadersTaskInput,
    startedAt: Date,
    endedAt: Date,
  ) {
    const recordsByAddress = new Map<
      string,
      Awaited<ReturnType<SimulationEvaluatorWorkerCacheService['getEventLogs']>>
    >();
    const missingAddresses: string[] = [];
    for (const address of input.candidateLeaders) {
      const records = await this.cache.getEventLogs({
        platform: input.simulation.platform,
        address,
        startedAt,
        endedAt,
      });
      if (records) recordsByAddress.set(address.toLowerCase(), records);
      else missingAddresses.push(address);
    }

    for (
      let offset = 0;
      offset < missingAddresses.length;
      offset += SIMULATION_EVALUATOR.eventLogAddressBatchSize
    ) {
      const addressBatch = missingAddresses.slice(
        offset,
        offset + SIMULATION_EVALUATOR.eventLogAddressBatchSize,
      );
      const fetchedByAddress = new Map<
        string,
        Awaited<
          ReturnType<SimulationEvaluatorWorkerClientService['getEventLogs']>
        >['eventLogs']
      >();
      let cursor:
        | {
            date: string;
            block: number;
            logIndex: number;
            contractId: number;
          }
        | null
        | undefined;
      do {
        const response = await this.client.getEventLogs({
          taskId,
          leaseToken,
          addresses: addressBatch,
          startedAt,
          endedAt,
          cursor,
        });
        for (const record of response.eventLogs) {
          const address = record.address.toLowerCase();
          const records = fetchedByAddress.get(address) || [];
          records.push(record);
          fetchedByAddress.set(address, records);
        }
        if (!response.done && !response.nextCursor) {
          throw new Error('Event-log page is missing a next cursor');
        }
        cursor = response.nextCursor;
        if (response.done) break;
      } while (cursor);
      await Promise.all(
        addressBatch.map(async (address) => {
          const records = fetchedByAddress.get(address.toLowerCase()) || [];
          await this.cache.putEventLogs(
            {
              platform: input.simulation.platform,
              address,
              startedAt,
              endedAt,
            },
            records,
          );
          recordsByAddress.set(address.toLowerCase(), records);
        }),
      );
    }
    return recordsByAddress;
  }

  private parseEvaluateLeadersInput(value: unknown): EvaluateLeadersTaskInput {
    if (
      !this.isRecord(value) ||
      !Array.isArray(value.candidateLeaders) ||
      !value.candidateLeaders.every((item) => typeof item === 'string') ||
      !this.isRecord(value.simulation)
    ) {
      throw new Error('Invalid evaluation task input');
    }
    const simulation = value.simulation as unknown as Simulation;
    if (!Object.values(Platform).includes(simulation.platform)) {
      throw new Error('Invalid simulation platform');
    }
    if (
      !this.isRecord(value.range) ||
      typeof value.range.startedAt !== 'string' ||
      typeof value.range.endedAt !== 'string' ||
      !Array.isArray(value.contracts) ||
      typeof value.eventLogWindowStartedAt !== 'string' ||
      typeof value.eventLogWindowEndedAt !== 'string' ||
      typeof value.behavioralEvaluationStartedAt !== 'string'
    ) {
      throw new Error('Incomplete evaluation task input');
    }
    return value as unknown as EvaluateLeadersTaskInput;
  }

  private validatePrebuildChunk(
    eventLogs: Awaited<
      ReturnType<SimulationEvaluatorWorkerClientService['getPrebuildChunk']>
    >['eventLogs'],
    nextCursor: Awaited<
      ReturnType<SimulationEvaluatorWorkerClientService['getPrebuildChunk']>
    >['nextCursor'],
    cursor: {
      date: string;
      block: number;
      logIndex: number;
      contractId: number;
    } | null,
    platform: Platform,
    startedAt: Date,
    endedAt: Date,
    done: boolean,
  ) {
    let previous = cursor;
    for (const eventLog of eventLogs) {
      const date = new Date(eventLog.date);
      if (
        eventLog.platform !== platform ||
        Number.isNaN(+date) ||
        date < startedAt ||
        date >= endedAt ||
        ![eventLog.contractId, eventLog.block, eventLog.logIndex].every(
          Number.isSafeInteger,
        )
      ) {
        throw new Error('Prebuild chunk contains an invalid event log');
      }
      const current = {
        date: date.toISOString(),
        block: eventLog.block,
        logIndex: eventLog.logIndex,
        contractId: eventLog.contractId,
      };
      if (previous && this.comparePrebuildCursor(current, previous) <= 0) {
        throw new Error('Prebuild chunk event logs are not strictly ordered');
      }
      previous = current;
    }

    if (!nextCursor) {
      if (!done) throw new Error('Prebuild chunk is missing a next cursor');
      return;
    }
    if (eventLogs.length === 0) {
      throw new Error('Prebuild chunk has a cursor but no event logs');
    }
    const last = previous!;
    if (this.comparePrebuildCursor(nextCursor, last) !== 0) {
      throw new Error(
        'Prebuild chunk cursor does not match its final event log',
      );
    }
  }

  private comparePrebuildCursor(
    left: { date: string; block: number; logIndex: number; contractId: number },
    right: {
      date: string;
      block: number;
      logIndex: number;
      contractId: number;
    },
  ) {
    return (
      +new Date(left.date) - +new Date(right.date) ||
      left.block - right.block ||
      left.logIndex - right.logIndex ||
      left.contractId - right.contractId
    );
  }

  private parsePrebuildPlatformCacheInput(
    value: unknown,
  ): PrebuildPlatformCacheTaskInput {
    if (
      !this.isRecord(value) ||
      !Object.values(Platform).includes(value.platform as Platform) ||
      typeof value.eventLogWindowStartedAt !== 'string' ||
      typeof value.eventLogWindowEndedAt !== 'string'
    ) {
      throw new Error('Invalid cache-prebuild input');
    }
    return value as unknown as PrebuildPlatformCacheTaskInput;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}

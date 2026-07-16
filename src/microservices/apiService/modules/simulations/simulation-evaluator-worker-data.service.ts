import { BadRequestException, Injectable } from '@nestjs/common';

import { Platform } from 'generated/prisma/enums';
import { SimulationEvaluatorTaskKind } from 'generated/prisma/enums';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';
import { PrismaService } from 'src/global/prisma.service';
import { SimulationEvaluatorTaskService } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator-task.service';
import {
  EventLogOrderCursor,
  getEventLogCursorWhere,
  getEventLogOrderBy,
} from '../trade-histories/event-log-identity.utils';

type EvaluationTaskInput = {
  candidateLeaders?: unknown;
  authorizedAddresses?: unknown;
  platform?: unknown;
  eventLogWindowStartedAt?: unknown;
  eventLogWindowEndedAt?: unknown;
};

type GetEventLogsInput = {
  taskId: string;
  workerId: string;
  leaseToken: string;
  addresses: string[];
  startedAt: Date;
  endedAt: Date;
  cursor?: EventLogOrderCursor;
};

@Injectable()
export class SimulationEvaluatorWorkerDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: SimulationEvaluatorTaskService,
  ) {}

  async getTaskInput(taskId: string, workerId: string, leaseToken: string) {
    const task = await this.getAuthorizedTask(taskId, workerId, leaseToken);
    return {
      id: task.id,
      kind: task.kind,
      simulationId: task.simulationId,
      simulationPlanId: task.simulationPlanId,
      rangeStartedAt: task.rangeStartedAt,
      rangeEndedAt: task.rangeEndedAt,
      inputChecksum: task.inputChecksum,
      input: task.input,
    };
  }

  async getEventLogs(input: GetEventLogsInput) {
    const task = await this.getAuthorizedTask(
      input.taskId,
      input.workerId,
      input.leaseToken,
    );
    const taskInput = task.input as EvaluationTaskInput;
    const platform = this.getPlatform(taskInput);
    const window = this.getEventLogWindow(taskInput);

    if (
      input.startedAt < window.startedAt ||
      input.endedAt > window.endedAt ||
      input.startedAt >= input.endedAt
    ) {
      throw new BadRequestException(
        'Requested event-log range is outside this task input',
      );
    }

    const normalizedAddresses = [
      ...new Set(input.addresses.map((address) => address.toLowerCase())),
    ];
    if (normalizedAddresses.length === 0) return [];
    if (
      normalizedAddresses.length > SIMULATION_EVALUATOR.eventLogAddressBatchSize
    ) {
      throw new BadRequestException(
        `addresses cannot exceed ${SIMULATION_EVALUATOR.eventLogAddressBatchSize} per request`,
      );
    }
    const candidateLeaders =
      task.kind === SimulationEvaluatorTaskKind.PrebuildPlatformCache
        ? null
        : this.getAuthorizedAddresses(taskInput);
    if (
      candidateLeaders &&
      normalizedAddresses.some((address) => !candidateLeaders.has(address))
    ) {
      throw new BadRequestException(
        'Requested address is not authorized for this task',
      );
    }

    const eventLogs = await this.prisma.perpTradingEventLog.findMany({
      select: {
        address: true,
        date: true,
        block: true,
        logIndex: true,
        contractId: true,
        platform: true,
        transactionHash: true,
        jsonLog: true,
        usdPnl: true,
      },
      where: {
        address: { in: normalizedAddresses },
        platform,
        date: { gte: input.startedAt, lt: input.endedAt },
        ...(input.cursor ? getEventLogCursorWhere(input.cursor) : {}),
      },
      orderBy: getEventLogOrderBy(),
      take: SIMULATION_EVALUATOR.eventLogRecordBatchSize,
    });
    const last = eventLogs.at(-1);
    return {
      eventLogs,
      nextCursor: last
        ? {
            date: last.date.toISOString(),
            block: last.block,
            logIndex: last.logIndex,
            contractId: last.contractId,
          }
        : null,
      done: eventLogs.length < SIMULATION_EVALUATOR.eventLogRecordBatchSize,
    };
  }

  async getPrebuildChunk(input: {
    taskId: string;
    workerId: string;
    leaseToken: string;
    cursor?: { contractId: number; block: number; logIndex: number };
  }) {
    const task = await this.getAuthorizedTask(
      input.taskId,
      input.workerId,
      input.leaseToken,
    );
    if (task.kind !== SimulationEvaluatorTaskKind.PrebuildPlatformCache) {
      throw new BadRequestException('Task is not a cache prebuild');
    }

    const taskInput = task.input as EvaluationTaskInput;
    const platform = this.getPlatform(taskInput);
    const window = this.getEventLogWindow(taskInput);
    const where = {
      platform,
      date: { gte: window.startedAt, lt: window.endedAt },
    };

    // Count only once per task, on the first chunk. The worker carries the
    // value forward while subsequent chunk requests stay inexpensive.
    const totalRecords = input.cursor
      ? undefined
      : await this.prisma.perpTradingEventLog.count({ where });

    const eventLogs = await this.prisma.perpTradingEventLog.findMany({
      select: {
        address: true,
        date: true,
        block: true,
        logIndex: true,
        contractId: true,
        platform: true,
        transactionHash: true,
        jsonLog: true,
        usdPnl: true,
      },
      where: {
        ...where,
        ...(input.cursor
          ? {
              OR: [
                { contractId: { gt: input.cursor.contractId } },
                {
                  contractId: input.cursor.contractId,
                  block: { gt: input.cursor.block },
                },
                {
                  contractId: input.cursor.contractId,
                  block: input.cursor.block,
                  logIndex: { gt: input.cursor.logIndex },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ contractId: 'asc' }, { block: 'asc' }, { logIndex: 'asc' }],
      take: SIMULATION_EVALUATOR.prebuildChunkSourceRecordLimit,
    });

    const last = eventLogs.at(-1);

    return {
      eventLogs,
      totalRecords,
      nextCursor: last
        ? {
            contractId: last.contractId,
            block: last.block,
            logIndex: last.logIndex,
          }
        : null,
      done:
        eventLogs.length < SIMULATION_EVALUATOR.prebuildChunkSourceRecordLimit,
    };
  }

  private async getAuthorizedTask(
    taskId: string,
    workerId: string,
    leaseToken: string,
  ) {
    const task = await this.tasks.getClaimedTask(taskId, workerId, leaseToken);
    if (!task)
      throw new BadRequestException('Evaluator task lease is no longer valid');
    return task;
  }

  private getAuthorizedAddresses(input: EvaluationTaskInput) {
    const addresses = Array.isArray(input.candidateLeaders)
      ? input.candidateLeaders
      : input.authorizedAddresses;
    if (
      !Array.isArray(addresses) ||
      !addresses.every((item) => typeof item === 'string')
    ) {
      throw new BadRequestException(
        'Evaluator task has no authorized address input',
      );
    }
    return new Set(addresses.map((address) => address.toLowerCase()));
  }

  private getPlatform(input: EvaluationTaskInput) {
    if (!Object.values(Platform).includes(input.platform as Platform)) {
      throw new BadRequestException('Evaluator task has no platform input');
    }
    return input.platform as Platform;
  }

  private getEventLogWindow(input: EvaluationTaskInput) {
    const startedAt = new Date(String(input.eventLogWindowStartedAt));
    const endedAt = new Date(String(input.eventLogWindowEndedAt));
    if (
      Number.isNaN(startedAt.getTime()) ||
      Number.isNaN(endedAt.getTime()) ||
      startedAt >= endedAt
    ) {
      throw new BadRequestException(
        'Evaluator task has an invalid event-log window',
      );
    }
    return { startedAt, endedAt };
  }
}

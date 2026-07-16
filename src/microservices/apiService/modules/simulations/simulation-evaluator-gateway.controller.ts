import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { gzipSync } from 'zlib';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';

import { SimulationEvaluatorTaskService } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator-task.service';
import { SimulationEvaluatorWorkerDataService } from './simulation-evaluator-worker-data.service';
import { SimulationEvaluatorWorkerAuthService } from './simulation-evaluator-worker-auth.service';

type LeaseRequest = {
  leaseToken?: string;
  progressRecords?: number;
  progressBytes?: number;
  progressMessage?: string;
};
type CompleteRequest = LeaseRequest & { result?: Record<string, unknown> };
type EventLogRequest = LeaseRequest & {
  addresses?: string[];
  startedAt?: string;
  endedAt?: string;
  cursor?: {
    date?: string;
    block?: number;
    logIndex?: number;
    contractId?: number;
  };
};
type EnrollmentRequest = { workerId?: string; publicKey?: string };

@Controller(SIMULATION_EVALUATOR.gateway.basePath)
export class SimulationEvaluatorGatewayController {
  constructor(
    private readonly tasks: SimulationEvaluatorTaskService,
    private readonly workerData: SimulationEvaluatorWorkerDataService,
    private readonly auth: SimulationEvaluatorWorkerAuthService,
  ) {}

  @Post('enroll')
  async enroll(@Body() body: EnrollmentRequest) {
    if (
      !body.workerId ||
      !body.publicKey ||
      body.workerId.length > 128 ||
      body.publicKey.length > 10_000
    ) {
      throw new BadRequestException('workerId and publicKey are required');
    }

    return {
      authorizationStatus: await this.auth.enroll(
        body.workerId,
        body.publicKey,
      ),
    };
  }

  @Post('presence')
  async presence(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const workerId = await this.authorize(
      headers,
      'POST',
      '/internal/simulation-evaluator/presence',
    );
    await this.auth.recordPresence(workerId);
    return { accepted: true };
  }

  @Post('poll')
  async poll(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const workerId = await this.authorize(
      headers,
      'POST',
      '/internal/simulation-evaluator/poll',
    );
    const task = await this.tasks.claimNextTask(workerId);
    return task ? { task } : { task: null };
  }

  @Post(':taskId/heartbeat')
  async heartbeat(
    @Param('taskId') taskId: string,
    @Body() body: LeaseRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const workerId = await this.authorize(
      headers,
      'POST',
      `/internal/simulation-evaluator/${taskId}/heartbeat`,
    );
    if (!body.leaseToken) {
      throw new BadRequestException('leaseToken is required');
    }
    const leaseExpiresAt = await this.tasks.heartbeat(
      taskId,
      workerId,
      body.leaseToken,
      body.progressRecords !== undefined || body.progressBytes !== undefined
        ? {
            progressRecords: body.progressRecords,
            progressBytes: body.progressBytes,
            progressMessage: body.progressMessage,
          }
        : undefined,
    );
    if (!leaseExpiresAt) {
      throw new ConflictException('Evaluator task lease is no longer valid');
    }
    return { leaseExpiresAt };
  }

  @Get(':taskId/input')
  async getInput(
    @Param('taskId') taskId: string,
    @Headers('x-simulation-task-lease') leaseToken: string | undefined,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const workerId = await this.authorize(
      headers,
      'GET',
      `/internal/simulation-evaluator/${taskId}/input`,
    );
    if (!leaseToken) {
      throw new BadRequestException('Task lease is required');
    }
    return this.workerData.getTaskInput(taskId, workerId, leaseToken);
  }

  @Get(':taskId/prebuild-chunk')
  async getPrebuildChunk(
    @Param('taskId') taskId: string,
    @Headers('x-simulation-task-lease') leaseToken: string | undefined,
    @Headers('x-simulation-prebuild-cursor') cursorText: string | undefined,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res() response: Response,
  ) {
    const workerId = await this.authorize(
      headers,
      'GET',
      `/internal/simulation-evaluator/${taskId}/prebuild-chunk`,
    );

    if (!leaseToken) {
      throw new BadRequestException('Task lease is required');
    }

    let cursor:
      | { contractId: number; block: number; logIndex: number }
      | undefined;

    if (cursorText) {
      try {
        const parsed = JSON.parse(cursorText);
        if (
          ![parsed.contractId, parsed.block, parsed.logIndex].every(
            Number.isSafeInteger,
          )
        ) {
          throw new Error();
        }

        cursor = parsed;
      } catch {
        throw new BadRequestException('Invalid prebuild cursor');
      }
    }

    const chunk = await this.workerData.getPrebuildChunk({
      taskId,
      workerId,
      leaseToken,
      cursor,
    });

    const targetBytes = SIMULATION_EVALUATOR.prebuildChunkTargetBytes;
    let low = 1;
    let high = chunk.eventLogs.length;
    let selected = chunk.eventLogs;

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = chunk.eventLogs.slice(0, middle);
      const candidatePayload = gzipSync(
        JSON.stringify({
          ...chunk,
          eventLogs: candidate,
          nextCursor: candidate.at(-1)
            ? {
                contractId: candidate.at(-1)!.contractId,
                block: candidate.at(-1)!.block,
                logIndex: candidate.at(-1)!.logIndex,
              }
            : null,
          done: chunk.done && middle === chunk.eventLogs.length,
        }),
        { level: 6 },
      );
      if (candidatePayload.length <= targetBytes) {
        selected = candidate;
        low = middle + 1;
      } else high = middle - 1;
    }
    const last = selected.at(-1);
    const payload = gzipSync(
      JSON.stringify({
        ...chunk,
        eventLogs: selected,
        nextCursor: last
          ? {
              contractId: last.contractId,
              block: last.block,
              logIndex: last.logIndex,
            }
          : null,
        done: chunk.done && selected.length === chunk.eventLogs.length,
      }),
      { level: 6 },
    );
    response
      .status(200)
      .set({
        'Content-Type': 'application/gzip',
        'Content-Length': String(payload.length),
      })
      .end(payload);
  }

  @Post(':taskId/event-logs')
  async getEventLogs(
    @Param('taskId') taskId: string,
    @Body() body: EventLogRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const workerId = await this.authorize(
      headers,
      'POST',
      `/internal/simulation-evaluator/${taskId}/event-logs`,
    );
    if (!body.leaseToken)
      throw new BadRequestException('leaseToken is required');
    if (
      !Array.isArray(body.addresses) ||
      !body.addresses.every((item) => typeof item === 'string')
    ) {
      throw new BadRequestException('addresses must be a string array');
    }
    const startedAt = new Date(body.startedAt || '');
    const endedAt = new Date(body.endedAt || '');
    if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
      throw new BadRequestException('startedAt and endedAt must be ISO dates');
    }
    const cursor = body.cursor
      ? {
          date: new Date(body.cursor.date || ''),
          block: body.cursor.block,
          logIndex: body.cursor.logIndex,
          contractId: body.cursor.contractId,
        }
      : undefined;
    if (
      cursor &&
      (Number.isNaN(cursor.date.getTime()) ||
        !Number.isSafeInteger(cursor.block) ||
        !Number.isSafeInteger(cursor.logIndex) ||
        !Number.isSafeInteger(cursor.contractId))
    ) {
      throw new BadRequestException('cursor is invalid');
    }
    return this.workerData.getEventLogs({
      taskId,
      workerId,
      leaseToken: body.leaseToken,
      addresses: body.addresses,
      startedAt,
      endedAt,
      cursor: cursor as
        | {
            date: Date;
            block: number;
            logIndex: number;
            contractId: number;
          }
        | undefined,
    });
  }

  @Post(':taskId/complete')
  async complete(
    @Param('taskId') taskId: string,
    @Body() body: CompleteRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const workerId = await this.authorize(
      headers,
      'POST',
      `/internal/simulation-evaluator/${taskId}/complete`,
    );
    if (!body.leaseToken)
      throw new BadRequestException('leaseToken is required');
    if (!body.result || Array.isArray(body.result)) {
      throw new BadRequestException('result must be an object');
    }
    const accepted = await this.tasks.complete({
      taskId,
      workerId,
      leaseToken: body.leaseToken,
      result: body.result,
    });
    if (!accepted)
      throw new ConflictException('Evaluator task lease is no longer valid');
    return { accepted: true };
  }

  @Post(':taskId/fail')
  async fail(
    @Param('taskId') taskId: string,
    @Body() body: LeaseRequest & { error?: string },
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    const workerId = await this.authorize(
      headers,
      'POST',
      `/internal/simulation-evaluator/${taskId}/fail`,
    );
    if (!body.leaseToken || !body.error)
      throw new BadRequestException('leaseToken and error are required');
    const accepted = await this.tasks.fail(
      taskId,
      workerId,
      body.leaseToken,
      body.error,
    );
    if (!accepted)
      throw new ConflictException('Evaluator task lease is no longer valid');
    return { accepted: true };
  }

  private async authorize(
    headers: Record<string, string | string[] | undefined>,
    method: string,
    path: string,
  ) {
    const value = (name: string) => {
      const header = headers[name];
      return Array.isArray(header) ? header[0] : header;
    };
    const worker = await this.auth.authenticate({
      workerId: value('x-simulation-worker-id'),
      timestamp: value('x-simulation-worker-timestamp'),
      signature: value('x-simulation-worker-signature'),
      method,
      path,
    });
    return worker.id;
  }
}

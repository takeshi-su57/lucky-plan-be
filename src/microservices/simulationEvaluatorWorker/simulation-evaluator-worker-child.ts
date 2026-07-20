import { promises as fs } from 'fs';
import { join } from 'path';

import { Platform } from 'generated/prisma/enums';
import { EventLogsService } from 'src/microservices/apiService/modules/trade-histories/event-logs.service';
import { Simulation } from 'src/microservices/apiService/modules/simulations/entities/simulations.entity';
import {
  CandidateEvaluation,
  ContractContext,
  SimulationLeaderEvaluatorService,
} from 'src/microservices/analyticsService/modules/simulations/simulation-leader-evaluator.service';
import { WorkerCachedEventLog } from './simulation-evaluator-worker-cache.service';

type EvaluateMessage = {
  type: 'evaluate';
  taskId: string;
  input: {
    simulation: Simulation;
    candidateLeaders: string[];
    range: { startedAt: string; endedAt: string };
    contracts: ContractContext[];
    eventLogWindowStartedAt: string;
    eventLogWindowEndedAt: string;
  };
};

type EvaluationProgressMessage = {
  type: 'progress';
  taskId: string;
  completedCandidates: number;
  totalCandidates: number;
  eventLogRecords: number;
  progressMessage: string;
};

const cacheDir = join(process.cwd(), '.cache', 'simulation-evaluator-worker');
const parentSessionPath = join(cacheDir, 'parent-session.json');
let parentSessionId: string | undefined;

process.on(
  'message',
  async (
    message: EvaluateMessage | { type: 'parent-session'; sessionId: string },
  ) => {
    if (message?.type === 'parent-session') {
      parentSessionId = message.sessionId;
      return;
    }
    if (!message || message.type !== 'evaluate') return;
    if (!parentSessionId) {
      process.send?.({
        type: 'error',
        taskId: message.taskId,
        error: 'Missing parent session',
      });
      return;
    }
    try {
      const result = await evaluate(message.input, (progress) =>
        process.send?.({
          type: 'progress',
          taskId: message.taskId,
          ...progress,
        } satisfies EvaluationProgressMessage),
      );
      process.send?.({ type: 'result', taskId: message.taskId, result });
    } catch (error) {
      process.send?.({
        type: 'error',
        taskId: message.taskId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

setInterval(() => void verifyParentSession(), 5_000).unref();

async function verifyParentSession() {
  if (!parentSessionId) return;
  try {
    const session = JSON.parse(
      await fs.readFile(parentSessionPath, 'utf8'),
    ) as {
      sessionId?: string;
      updatedAt?: number;
    };
    if (
      session.sessionId !== parentSessionId ||
      typeof session.updatedAt !== 'number' ||
      !Number.isFinite(session.updatedAt) ||
      Date.now() - session.updatedAt > 15_000
    ) {
      process.exit(0);
    }
  } catch {
    process.exit(0);
  }
}

async function evaluate(
  input: EvaluateMessage['input'],
  reportProgress: (progress: Omit<EvaluationProgressMessage, 'type' | 'taskId'>) => void,
) {
  const rangeStartedAt = new Date(input.range.startedAt);
  const eventLogWindowStartedAt = new Date(input.eventLogWindowStartedAt);
  const eventLogWindowEndedAt = new Date(input.eventLogWindowEndedAt);
  const recentActivityCutoff = new Date(rangeStartedAt);
  recentActivityCutoff.setUTCDate(recentActivityCutoff.getUTCDate() - 30);
  const minimumTradeCount = Math.min(
    ...input.simulation.trade.map((range) => range.min),
  );
  const contractById = new Map(
    input.contracts.map((contract) => [contract.id, contract]),
  );
  const evaluations: CandidateEvaluation[] = [];
  const totalCandidates = input.candidateLeaders.length;
  let completedCandidates = 0;
  let eventLogRecords = 0;

  reportProgress({
    completedCandidates,
    totalCandidates,
    eventLogRecords,
    progressMessage: `Preparing cached history for ${totalCandidates} leaders`,
  });

  for (const leaderAddress of input.candidateLeaders) {
    const records = await readCachedLogs(
      input.simulation.platform,
      leaderAddress,
      eventLogWindowStartedAt,
      eventLogWindowEndedAt,
    );
    eventLogRecords += records.length;
    const recentTradeCount = records.filter((record) => {
      const date = new Date(record.date);
      return date >= recentActivityCutoff && date < rangeStartedAt;
    }).length;
    if (recentTradeCount >= minimumTradeCount) {
      const histories = SimulationLeaderEvaluatorService.eventLogsToHistories(
        records.map((record) => ({ ...record, date: new Date(record.date) })),
        contractById,
      );
      const positions = EventLogsService.buildPerpTradePositionsWithSummary(
        input.simulation.platform,
        histories,
        {
          collateralRanges: input.simulation.collateral,
          sizeRanges: input.simulation.size,
          leverageRanges: input.simulation.leverage,
        },
      ).positions;
      const evaluation =
        SimulationLeaderEvaluatorService.evaluateLeaderPositionsForSimulation(
          leaderAddress,
          SimulationLeaderEvaluatorService.getClosedPositionsBefore(
            positions,
            rangeStartedAt,
          ),
          input.simulation,
        );
      if (
        !evaluation.rejectedReason &&
        input.simulation.score.some(
          (range) =>
            evaluation.score >= range.min && evaluation.score <= range.max,
        )
      ) {
        evaluations.push(evaluation);
      }
    }
    completedCandidates += 1;
    reportProgress({
      completedCandidates,
      totalCandidates,
      eventLogRecords,
      progressMessage: `Evaluated ${completedCandidates} of ${totalCandidates} leaders (${eventLogRecords.toLocaleString()} cached event logs read)`,
    });
  }
  return { evaluatedCandidates: evaluations };
}

async function readCachedLogs(
  platform: Platform,
  address: string,
  startedAt: Date,
  endedAt: Date,
) {
  const records = await Promise.all(
    monthBuckets(startedAt, endedAt).map(async ({ year, month }) => {
      try {
        return JSON.parse(
          await fs.readFile(
            join(
              cacheDir,
              platform,
              address.toLowerCase(),
              String(year),
              String(month).padStart(2, '0'),
              'eventLog.json',
            ),
            'utf8',
          ),
        ) as WorkerCachedEventLog[];
      } catch {
        return [] as WorkerCachedEventLog[];
      }
    }),
  );
  const unique = new Map<string, WorkerCachedEventLog>();
  for (const record of records.flat()) {
    const date = new Date(record.date);
    if (date >= startedAt && date < endedAt) {
      unique.set(
        `${record.contractId}:${record.block}:${record.logIndex}`,
        record,
      );
    }
  }
  return [...unique.values()].sort(
    (a, b) =>
      +new Date(a.date) - +new Date(b.date) ||
      a.block - b.block ||
      a.logIndex - b.logIndex,
  );
}

function monthBuckets(startedAt: Date, endedAt: Date) {
  const buckets: { year: number; month: number }[] = [];
  const cursor = new Date(
    Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), 1),
  );
  while (cursor < endedAt) {
    buckets.push({
      year: cursor.getUTCFullYear(),
      month: cursor.getUTCMonth() + 1,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return buckets;
}

import { describe, expect, it, jest } from '@jest/globals';

import { Platform } from 'generated/prisma/enums';

import { SimulationEvaluatorWorkerEvaluationService } from './simulation-evaluator-worker-evaluation.service';

describe('SimulationEvaluatorWorkerEvaluationService prebuild checkpoints', () => {
  it('resumes from the persisted cursor and clears the checkpoint after completion', async () => {
    const cursor = { contractId: 10, block: 20, logIndex: 30 };
    const client = {
      getPrebuildChunk: jest.fn(async (..._args: unknown[]) => ({
        eventLogs: [],
        nextCursor: null,
        done: true,
        totalRecords: 100,
        compressedBytes: 50,
      })),
      reportTaskProgress: jest.fn(),
    };
    const cache = {
      hasPlatformCoverage: jest.fn(() => false),
      getPrebuildTaskCheckpoint: jest.fn(() => ({
        cursor,
        done: false,
        recordsProcessed: 60,
        bytesDownloaded: 500,
        totalRecords: 100,
      })),
      mergeEventLogs: jest.fn(async () => undefined),
      savePrebuildTaskCheckpoint: jest.fn(),
      markPlatformCoverage: jest.fn(),
      clearPrebuildTaskCheckpoint: jest.fn(),
    };
    const service = new SimulationEvaluatorWorkerEvaluationService(
      client as never,
      cache as never,
    );
    const startedAt = '2026-01-01T00:00:00.000Z';
    const endedAt = '2026-02-01T00:00:00.000Z';

    const result = await service.prebuildPlatformCache('task-1', 'lease-1', {
      platform: Platform.GNS,
      eventLogWindowStartedAt: startedAt,
      eventLogWindowEndedAt: endedAt,
    });

    expect(client.getPrebuildChunk).toHaveBeenCalledWith(
      'task-1',
      'lease-1',
      cursor,
    );
    expect(cache.savePrebuildTaskCheckpoint).toHaveBeenCalledWith(
      'task-1',
      Platform.GNS,
      new Date(startedAt),
      new Date(endedAt),
      {
        cursor: null,
        done: true,
        recordsProcessed: 60,
        bytesDownloaded: 550,
        totalRecords: 100,
      },
    );
    expect(cache.clearPrebuildTaskCheckpoint).toHaveBeenCalledWith('task-1');
    expect(result).toMatchObject({
      progressRecords: 60,
      progressBytes: 550,
      progressPercent: 100,
    });
  });
});

import { mkdir, mkdtemp, rm } from 'fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it, jest } from '@jest/globals';

import { Platform } from 'generated/prisma/enums';
import {
  SimulationEvaluatorWorkerCacheService,
  WorkerCachedEventLog,
} from './simulation-evaluator-worker-cache.service';

const startedAt = new Date('2026-01-01T00:00:00.000Z');
const endedAt = new Date('2026-02-01T00:00:00.000Z');

function eventLog(
  overrides: Partial<WorkerCachedEventLog> = {},
): WorkerCachedEventLog {
  return {
    address: '0xAbC',
    date: '2026-01-15T12:00:00.000Z',
    block: 100,
    logIndex: 2,
    contractId: 3,
    platform: Platform.GNS,
    transactionHash: '0xfirst',
    jsonLog: '{"first":true}',
    usdPnl: 12.5,
    ...overrides,
  };
}

describe('SimulationEvaluatorWorkerCacheService event-log backends', () => {
  it('upgrades a legacy metadata cache and records SQLite migrations', async () => {
    const cacheRoot = await mkdtemp(join(tmpdir(), 'evaluator-cache-'));
    const cacheDirectory = join(
      cacheRoot,
      '.cache',
      'simulation-evaluator-worker',
    );
    const originalDriver =
      process.env.SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER;
    const originalName = process.env.SIMULATION_EVALUATOR_WORKER_NAME;
    const cwd = jest.spyOn(process, 'cwd').mockReturnValue(cacheRoot);
    process.env.SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER = 'sqlite';
    process.env.SIMULATION_EVALUATOR_WORKER_NAME = 'cache-test';
    await mkdir(cacheDirectory, { recursive: true });
    const legacy = new DatabaseSync(join(cacheDirectory, 'cache.sqlite'));
    legacy.exec(`
      CREATE TABLE worker_identity (
        id INTEGER PRIMARY KEY, worker_id TEXT NOT NULL,
        public_key TEXT NOT NULL, private_key TEXT NOT NULL
      ) STRICT;
      CREATE TABLE prebuild_task_checkpoint (
        task_id TEXT PRIMARY KEY, platform TEXT NOT NULL,
        started_at TEXT NOT NULL, ended_at TEXT NOT NULL,
        done INTEGER NOT NULL, records_processed INTEGER NOT NULL,
        bytes_downloaded INTEGER NOT NULL, total_records INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    legacy.close();
    const cache = new SimulationEvaluatorWorkerCacheService();

    try {
      await cache.onModuleInit();
      const migrated = new DatabaseSync(join(cacheDirectory, 'cache.sqlite'), {
        readOnly: true,
      });
      expect(
        migrated
          .prepare('SELECT name FROM worker_cache_migration ORDER BY name')
          .all(),
      ).toEqual([
        { name: 'base-v1' },
        { name: 'prebuild-checkpoint-cursor-v3' },
        { name: 'sqlite-event-log-v1' },
        { name: 'worker-identity-display-name-v2' },
      ]);
      expect(
        migrated.prepare('PRAGMA table_info(prebuild_task_checkpoint)').all(),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'cursor_date' }),
        ]),
      );
      migrated.close();
    } finally {
      cache.onModuleDestroy();
      cwd.mockRestore();
      if (originalDriver === undefined) {
        delete process.env.SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER;
      } else {
        process.env.SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER =
          originalDriver;
      }
      if (originalName === undefined) {
        delete process.env.SIMULATION_EVALUATOR_WORKER_NAME;
      } else {
        process.env.SIMULATION_EVALUATOR_WORKER_NAME = originalName;
      }
      await rm(cacheRoot, { recursive: true, force: true });
    }
  });

  it.each(['file', 'sqlite'] as const)(
    '%s preserves last-record-wins cache semantics',
    async (driver) => {
      const cacheRoot = await mkdtemp(join(tmpdir(), 'evaluator-cache-'));
      const originalDriver =
        process.env.SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER;
      const originalName = process.env.SIMULATION_EVALUATOR_WORKER_NAME;
      const cwd = jest.spyOn(process, 'cwd').mockReturnValue(cacheRoot);
      process.env.SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER = driver;
      process.env.SIMULATION_EVALUATOR_WORKER_NAME = 'cache-test';
      const cache = new SimulationEvaluatorWorkerCacheService();

      try {
        await cache.onModuleInit();
        await cache.mergeEventLogs([
          eventLog(),
          eventLog({ transactionHash: '0xlast', jsonLog: '{"last":true}' }),
        ]);
        cache.markPlatformCoverage(Platform.GNS, startedAt, endedAt);

        if (driver === 'sqlite') {
          const database = new DatabaseSync(
            join(
              cacheRoot,
              '.cache',
              'simulation-evaluator-worker',
              'cache.sqlite',
            ),
            { readOnly: true },
          );
          expect(
            database
              .prepare("PRAGMA index_list('perp_trading_event_log')")
              .all(),
          ).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                name: 'perp_trading_event_log_platform_address_date_idx',
              }),
            ]),
          );
          database.close();
        }

        await expect(
          cache.getEventLogs({
            platform: Platform.GNS,
            address: '0xabc',
            startedAt,
            endedAt,
          }),
        ).resolves.toEqual([
          expect.objectContaining({
            address: driver === 'sqlite' ? '0xabc' : '0xAbC',
            transactionHash: '0xlast',
            jsonLog: '{"last":true}',
          }),
        ]);
      } finally {
        cache.onModuleDestroy();
        cwd.mockRestore();
        if (originalDriver === undefined) {
          delete process.env.SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER;
        } else {
          process.env.SIMULATION_EVALUATOR_EVENT_LOG_CACHE_DRIVER =
            originalDriver;
        }
        if (originalName === undefined) {
          delete process.env.SIMULATION_EVALUATOR_WORKER_NAME;
        } else {
          process.env.SIMULATION_EVALUATOR_WORKER_NAME = originalName;
        }
        await rm(cacheRoot, { recursive: true, force: true });
      }
    },
  );
});

import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'fs';
import { generateKeyPairSync, randomUUID } from 'crypto';
import { createInterface } from 'readline/promises';
import { dirname, join } from 'path';
import { hostname } from 'os';

import { Platform } from 'generated/prisma/enums';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';
import {
  coversRange,
  mergeRanges,
} from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator-coverage';

export type WorkerCachedEventLog = {
  address: string;
  date: string;
  block: number;
  logIndex: number;
  contractId: number;
  platform: Platform;
  transactionHash: string;
  jsonLog: string;
  usdPnl: number;
};

export type SimulationEvaluatorWorkerIdentity = {
  workerId: string;
  displayName: string;
  publicKey: string;
  privateKey: string;
};

export type PrebuildTaskCursor = {
  contractId: number;
  block: number;
  logIndex: number;
};

export type PrebuildTaskCheckpoint = {
  cursor: PrebuildTaskCursor | null;
  done: boolean;
  recordsProcessed: number;
  bytesDownloaded: number;
  totalRecords: number;
};

@Injectable()
export class SimulationEvaluatorWorkerCacheService
  implements OnModuleInit, OnModuleDestroy
{
  private database?: DatabaseSync;
  private identity?: SimulationEvaluatorWorkerIdentity;
  private readonly cacheDir = join(
    process.cwd(),
    ...SIMULATION_EVALUATOR.workerCacheDirectory,
  );

  async onModuleInit() {
    await fs.mkdir(this.cacheDir, { recursive: true });
    this.database = new DatabaseSync(join(this.cacheDir, 'cache.sqlite'));
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS worker_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        worker_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        private_key TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS platform_cache_coverage (
        platform TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        PRIMARY KEY (platform, started_at, ended_at)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS address_cache_coverage (
        platform TEXT NOT NULL,
        address TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        PRIMARY KEY (platform, address, started_at, ended_at)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS prebuild_task_checkpoint (
        task_id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT NOT NULL,
        cursor_contract_id INTEGER,
        cursor_block INTEGER,
        cursor_log_index INTEGER,
        done INTEGER NOT NULL DEFAULT 0,
        records_processed INTEGER NOT NULL DEFAULT 0,
        bytes_downloaded INTEGER NOT NULL DEFAULT 0,
        total_records INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      ) STRICT;
    `);
    const columns = this.database
      .prepare('PRAGMA table_info(worker_identity)')
      .all() as { name: string }[];
    if (!columns.some((column) => column.name === 'display_name')) {
      this.database.exec(
        'ALTER TABLE worker_identity ADD COLUMN display_name TEXT',
      );
    }
    this.identity =
      this.readWorkerIdentity() || (await this.createWorkerIdentity());
    const identity = this.identity;
    console.log(
      `[simulation-evaluator-worker] Worker ID: ${identity.workerId} (${identity.displayName})`,
    );
  }

  getWorkerIdentity(): SimulationEvaluatorWorkerIdentity {
    if (!this.identity) {
      throw new Error(
        'Simulation evaluator worker identity has not initialized',
      );
    }
    return this.identity;
  }

  private readWorkerIdentity(): SimulationEvaluatorWorkerIdentity | undefined {
    const database = this.getDatabase();
    const existing = database
      .prepare(
        'SELECT worker_id, display_name, public_key, private_key FROM worker_identity WHERE id = 1',
      )
      .get() as
      | {
          worker_id: string;
          display_name: string | null;
          public_key: string;
          private_key: string;
        }
      | undefined;
    if (existing) {
      return {
        workerId: existing.worker_id,
        displayName:
          existing.display_name || this.getDisplayName(existing.worker_id),
        publicKey: existing.public_key,
        privateKey: existing.private_key,
      };
    }

    return undefined;
  }

  private async createWorkerIdentity(): Promise<SimulationEvaluatorWorkerIdentity> {
    const database = this.getDatabase();
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');

    const identity = {
      workerId: '',
      displayName: '',
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey: privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    };
    const displayName = await this.getInitialDisplayName();
    identity.displayName = displayName;
    identity.workerId = `${displayName}_${randomUUID()}`;
    database
      .prepare(
        'INSERT INTO worker_identity (id, worker_id, display_name, public_key, private_key) VALUES (1, ?, ?, ?, ?)',
      )
      .run(
        identity.workerId,
        identity.displayName,
        identity.publicKey,
        identity.privateKey,
      );
    return identity;
  }

  private getDatabase() {
    if (!this.database) {
      throw new Error('Simulation evaluator worker cache has not initialized');
    }
    return this.database;
  }

  private getDisplayName(workerId?: string) {
    const configuredName = process.env.SIMULATION_EVALUATOR_WORKER_NAME?.trim();
    if (configuredName) return configuredName.slice(0, 128);
    if (hostname()) return hostname().slice(0, 128);
    return `worker-${workerId?.slice(0, 8) || 'unknown'}`;
  }

  private async getInitialDisplayName() {
    const configuredName = process.env.SIMULATION_EVALUATOR_WORKER_NAME?.trim();
    if (configuredName) return this.validateWorkerName(configuredName);

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error(
        'SIMULATION_EVALUATOR_WORKER_NAME is required for a first non-interactive worker start',
      );
    }

    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      while (true) {
        const name = await readline.question(
          'Simulation evaluator worker name: ',
        );
        try {
          return this.validateWorkerName(name.trim());
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      readline.close();
    }
  }

  private validateWorkerName(value: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) {
      throw new Error(
        'Worker name must be 1-64 characters: letters, numbers, hyphens, or underscores',
      );
    }
    return value;
  }

  onModuleDestroy() {
    this.database?.close();
  }

  async getEventLogs(input: {
    platform: Platform;
    address: string;
    startedAt: Date;
    endedAt: Date;
  }): Promise<WorkerCachedEventLog[] | null> {
    if (
      !this.hasPlatformCoverage(
        input.platform,
        input.startedAt,
        input.endedAt,
      ) &&
      !this.hasAddressCoverage(
        input.platform,
        input.address,
        input.startedAt,
        input.endedAt,
      )
    )
      return null;
    const buckets = this.monthBuckets(input.startedAt, input.endedAt);
    const records = (
      await Promise.all(
        buckets.map(async ({ year, month }) => {
          try {
            return JSON.parse(
              await fs.readFile(
                this.eventLogPath(input.platform, input.address, year, month),
                'utf8',
              ),
            ) as WorkerCachedEventLog[];
          } catch {
            return [];
          }
        }),
      )
    ).flat();
    return this.sortAndDedupe(records).filter((record) => {
      const date = new Date(record.date);
      return date >= input.startedAt && date < input.endedAt;
    });
  }

  async putEventLogs(
    input: {
      platform: Platform;
      address: string;
      startedAt: Date;
      endedAt: Date;
    },
    eventLogs: WorkerCachedEventLog[],
  ) {
    await this.mergeEventLogs(eventLogs);
    this.markAddressCoverage(
      input.platform,
      input.address,
      input.startedAt,
      input.endedAt,
    );
  }

  async mergeEventLogs(eventLogs: WorkerCachedEventLog[]) {
    const groups = new Map<string, WorkerCachedEventLog[]>();

    for (const eventLog of eventLogs) {
      const date = new Date(eventLog.date);

      if (Number.isNaN(+date)) {
        continue;
      }

      const key = `${eventLog.platform}:${eventLog.address.toLowerCase()}:${date.getUTCFullYear()}:${date.getUTCMonth() + 1}`;
      const group = groups.get(key) || [];
      group.push(eventLog);
      groups.set(key, group);
    }

    await Promise.all(
      [...groups.entries()].map(async ([key, incoming]) => {
        const [platform, address, yearText, monthText] = key.split(':');
        const path = this.eventLogPath(
          platform as Platform,
          address,
          +yearText,
          +monthText,
        );
        await fs.mkdir(dirname(path), { recursive: true });

        let existing: WorkerCachedEventLog[] = [];

        try {
          existing = JSON.parse(
            await fs.readFile(path, 'utf8'),
          ) as WorkerCachedEventLog[];
        } catch {
          /* bucket is new */
        }

        const temporary = `${path}.tmp`;

        await fs.writeFile(
          temporary,
          JSON.stringify(this.sortAndDedupe([...existing, ...incoming])),
          'utf8',
        );

        await fs.rename(temporary, path);
      }),
    );
  }

  getPrebuildTaskCheckpoint(
    taskId: string,
    platform: Platform,
    startedAt: Date,
    endedAt: Date,
  ): PrebuildTaskCheckpoint | null {
    const row = this.getDatabase()
      .prepare(
        `SELECT cursor_contract_id, cursor_block, cursor_log_index, done,
                records_processed, bytes_downloaded, total_records
         FROM prebuild_task_checkpoint
         WHERE task_id = ? AND platform = ? AND started_at = ? AND ended_at = ?`,
      )
      .get(taskId, platform, startedAt.toISOString(), endedAt.toISOString()) as
      | {
          cursor_contract_id: number | null;
          cursor_block: number | null;
          cursor_log_index: number | null;
          done: number;
          records_processed: number;
          bytes_downloaded: number;
          total_records: number;
        }
      | undefined;
    if (!row) return null;

    const hasCursor = [
      row.cursor_contract_id,
      row.cursor_block,
      row.cursor_log_index,
    ].every(Number.isSafeInteger);
    return {
      cursor: hasCursor
        ? {
            contractId: row.cursor_contract_id!,
            block: row.cursor_block!,
            logIndex: row.cursor_log_index!,
          }
        : null,
      done: row.done === 1,
      recordsProcessed: row.records_processed,
      bytesDownloaded: row.bytes_downloaded,
      totalRecords: row.total_records,
    };
  }

  savePrebuildTaskCheckpoint(
    taskId: string,
    platform: Platform,
    startedAt: Date,
    endedAt: Date,
    checkpoint: PrebuildTaskCheckpoint,
  ) {
    this.getDatabase()
      .prepare(
        `INSERT INTO prebuild_task_checkpoint (
           task_id, platform, started_at, ended_at,
           cursor_contract_id, cursor_block, cursor_log_index, done,
           records_processed, bytes_downloaded, total_records, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           platform = excluded.platform,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           cursor_contract_id = excluded.cursor_contract_id,
           cursor_block = excluded.cursor_block,
           cursor_log_index = excluded.cursor_log_index,
           done = excluded.done,
           records_processed = excluded.records_processed,
           bytes_downloaded = excluded.bytes_downloaded,
           total_records = excluded.total_records,
           updated_at = excluded.updated_at`,
      )
      .run(
        taskId,
        platform,
        startedAt.toISOString(),
        endedAt.toISOString(),
        checkpoint.cursor?.contractId ?? null,
        checkpoint.cursor?.block ?? null,
        checkpoint.cursor?.logIndex ?? null,
        checkpoint.done ? 1 : 0,
        checkpoint.recordsProcessed,
        checkpoint.bytesDownloaded,
        checkpoint.totalRecords,
        new Date().toISOString(),
      );
  }

  clearPrebuildTaskCheckpoint(taskId: string) {
    this.getDatabase()
      .prepare('DELETE FROM prebuild_task_checkpoint WHERE task_id = ?')
      .run(taskId);
  }

  hasPlatformCoverage(platform: Platform, startedAt: Date, endedAt: Date) {
    const rows = this.database
      ?.prepare(
        'SELECT started_at, ended_at FROM platform_cache_coverage WHERE platform = ?',
      )
      .all(platform) as { started_at: string; ended_at: string }[] | undefined;
    return coversRange(
      (rows || []).map((row) => ({
        coveredStartAt: new Date(row.started_at),
        coveredEndAt: new Date(row.ended_at),
      })),
      startedAt,
      endedAt,
    );
  }

  markPlatformCoverage(platform: Platform, startedAt: Date, endedAt: Date) {
    const database = this.getDatabase();
    const existing = database
      .prepare(
        'SELECT started_at, ended_at FROM platform_cache_coverage WHERE platform = ?',
      )
      .all(platform) as { started_at: string; ended_at: string }[];
    const merged = mergeRanges([
      ...existing.map((row) => ({
        coveredStartAt: new Date(row.started_at),
        coveredEndAt: new Date(row.ended_at),
      })),
      { coveredStartAt: startedAt, coveredEndAt: endedAt },
    ]);
    database.exec('BEGIN');
    try {
      database
        .prepare('DELETE FROM platform_cache_coverage WHERE platform = ?')
        .run(platform);
      const insert = database.prepare(
        'INSERT INTO platform_cache_coverage (platform, started_at, ended_at) VALUES (?, ?, ?)',
      );
      for (const range of merged) {
        insert.run(
          platform,
          range.coveredStartAt.toISOString(),
          range.coveredEndAt.toISOString(),
        );
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  private hasAddressCoverage(
    platform: Platform,
    address: string,
    startedAt: Date,
    endedAt: Date,
  ) {
    const row = this.database
      ?.prepare(
        'SELECT 1 FROM address_cache_coverage WHERE platform = ? AND address = ? AND started_at <= ? AND ended_at >= ? LIMIT 1',
      )
      .get(
        platform,
        address.toLowerCase(),
        startedAt.toISOString(),
        endedAt.toISOString(),
      );
    return Boolean(row);
  }

  private markAddressCoverage(
    platform: Platform,
    address: string,
    startedAt: Date,
    endedAt: Date,
  ) {
    this.database
      ?.prepare(
        'INSERT OR IGNORE INTO address_cache_coverage (platform, address, started_at, ended_at) VALUES (?, ?, ?, ?)',
      )
      .run(
        platform,
        address.toLowerCase(),
        startedAt.toISOString(),
        endedAt.toISOString(),
      );
  }

  private eventLogPath(
    platform: Platform,
    address: string,
    year: number,
    month: number,
  ) {
    return join(
      this.cacheDir,
      platform,
      address.toLowerCase(),
      String(year),
      String(month).padStart(2, '0'),
      'eventLog.json',
    );
  }

  private monthBuckets(startedAt: Date, endedAt: Date) {
    const buckets: { year: number; month: number }[] = [];
    const current = new Date(
      Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), 1),
    );
    while (current < endedAt) {
      buckets.push({
        year: current.getUTCFullYear(),
        month: current.getUTCMonth() + 1,
      });
      current.setUTCMonth(current.getUTCMonth() + 1);
    }
    return buckets;
  }

  private sortAndDedupe(records: WorkerCachedEventLog[]) {
    const unique = new Map<string, WorkerCachedEventLog>();
    for (const record of records)
      unique.set(
        `${record.contractId}:${record.block}:${record.logIndex}`,
        record,
      );
    return [...unique.values()].sort(
      (a, b) =>
        +new Date(a.date) - +new Date(b.date) ||
        a.block - b.block ||
        a.logIndex - b.logIndex ||
        a.contractId - b.contractId,
    );
  }
}

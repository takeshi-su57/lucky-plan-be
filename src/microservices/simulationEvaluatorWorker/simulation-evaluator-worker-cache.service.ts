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
import {
  getSimulationEvaluatorEventLogCacheDriver,
  SimulationEvaluatorEventLogCacheDriver,
} from './simulation-evaluator-worker-event-log-cache-driver';

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
  date: string;
  block: number;
  logIndex: number;
  contractId: number;
};

export type PrebuildTaskCheckpoint = {
  cursor: PrebuildTaskCursor | null;
  done: boolean;
  recordsProcessed: number;
  bytesDownloaded: number;
  totalRecords: number;
};

export type SqlitePrebuildChunkCommit = {
  taskId: string;
  platform: Platform;
  startedAt: Date;
  endedAt: Date;
  eventLogs: WorkerCachedEventLog[];
  checkpoint: PrebuildTaskCheckpoint;
  completed: boolean;
};

const CACHE_MIGRATIONS = new Set([
  'base-v1',
  'worker-identity-display-name-v2',
  'prebuild-checkpoint-cursor-v3',
  'sqlite-event-log-v1',
]);

@Injectable()
export class SimulationEvaluatorWorkerCacheService
  implements OnModuleInit, OnModuleDestroy
{
  private database?: DatabaseSync;
  private identity?: SimulationEvaluatorWorkerIdentity;
  private readonly eventLogCacheDriver: SimulationEvaluatorEventLogCacheDriver =
    getSimulationEvaluatorEventLogCacheDriver();
  private readonly cacheDir = join(
    process.cwd(),
    ...SIMULATION_EVALUATOR.workerCacheDirectory,
  );

  async onModuleInit() {
    await fs.mkdir(this.cacheDir, { recursive: true });
    this.database = new DatabaseSync(join(this.cacheDir, 'cache.sqlite'), {
      timeout: 5_000,
    });
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
    `);
    this.applyCacheMigrations();
    this.identity =
      this.readWorkerIdentity() || (await this.createWorkerIdentity());
    const identity = this.identity;
    console.log(
      `[simulation-evaluator-worker] Worker ID: ${identity.workerId} (${identity.displayName})`,
    );
  }

  private applyCacheMigrations() {
    const database = this.getDatabase();
    database.exec(`
      CREATE TABLE IF NOT EXISTS worker_cache_migration (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);
    const unsupportedMigration = database
      .prepare('SELECT name FROM worker_cache_migration')
      .all()
      .map((row) => (row as { name: string }).name)
      .find((name) => !CACHE_MIGRATIONS.has(name));
    if (unsupportedMigration) {
      throw new Error(
        `Worker cache was migrated by a newer unsupported release (${unsupportedMigration})`,
      );
    }
    this.applyCacheMigration('base-v1', () => {
      database.exec(`
      CREATE TABLE IF NOT EXISTS worker_identity (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        worker_id TEXT NOT NULL,
        display_name TEXT,
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
        cursor_date TEXT,
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
    });
    this.applyCacheMigration('worker-identity-display-name-v2', () => {
      this.addColumnIfMissing('worker_identity', 'display_name', 'TEXT');
    });
    this.applyCacheMigration('prebuild-checkpoint-cursor-v3', () => {
      this.addColumnIfMissing(
        'prebuild_task_checkpoint',
        'cursor_date',
        'TEXT',
      );
      this.addColumnIfMissing(
        'prebuild_task_checkpoint',
        'cursor_contract_id',
        'INTEGER',
      );
      this.addColumnIfMissing(
        'prebuild_task_checkpoint',
        'cursor_block',
        'INTEGER',
      );
      this.addColumnIfMissing(
        'prebuild_task_checkpoint',
        'cursor_log_index',
        'INTEGER',
      );
    });
    if (this.eventLogCacheDriver === 'sqlite') {
      this.applyCacheMigration('sqlite-event-log-v1', () => {
        database.exec(`
        CREATE TABLE IF NOT EXISTS perp_trading_event_log (
          contract_id INTEGER NOT NULL,
          json_log TEXT NOT NULL,
          usd_pnl REAL NOT NULL,
          block INTEGER NOT NULL,
          log_index INTEGER NOT NULL,
          transaction_hash TEXT NOT NULL,
          date TEXT NOT NULL,
          address TEXT NOT NULL,
          platform TEXT NOT NULL,
          PRIMARY KEY (contract_id, block, log_index)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS perp_trading_event_log_platform_address_date_idx
          ON perp_trading_event_log (
            platform, address, date, block, log_index, contract_id
          );
        `);
      });
    }
    this.validateCacheSchema();
  }

  private validateCacheSchema() {
    this.requireTableColumns('worker_identity', [
      'id',
      'worker_id',
      'display_name',
      'public_key',
      'private_key',
    ]);
    this.requireTableColumns('platform_cache_coverage', [
      'platform',
      'started_at',
      'ended_at',
    ]);
    this.requireTableColumns('address_cache_coverage', [
      'platform',
      'address',
      'started_at',
      'ended_at',
    ]);
    this.requireTableColumns('prebuild_task_checkpoint', [
      'task_id',
      'platform',
      'started_at',
      'ended_at',
      'cursor_date',
      'cursor_contract_id',
      'cursor_block',
      'cursor_log_index',
      'done',
      'records_processed',
      'bytes_downloaded',
      'total_records',
      'updated_at',
    ]);
    if (this.eventLogCacheDriver !== 'sqlite') return;

    this.requireTableColumns('perp_trading_event_log', [
      'contract_id',
      'json_log',
      'usd_pnl',
      'block',
      'log_index',
      'transaction_hash',
      'date',
      'address',
      'platform',
    ]);
    this.requirePrimaryKey('perp_trading_event_log', [
      'contract_id',
      'block',
      'log_index',
    ]);
    const indexes = this.getDatabase()
      .prepare("PRAGMA index_list('perp_trading_event_log')")
      .all() as { name: string }[];
    if (
      !indexes.some(
        (index) =>
          index.name === 'perp_trading_event_log_platform_address_date_idx',
      )
    ) {
      throw new Error(
        'SQLite event-log cache is missing its evaluator lookup index; rebuild the local cache',
      );
    }
  }

  private requireTableColumns(table: string, expectedColumns: string[]) {
    const actualColumns = new Set(
      (
        this.getDatabase().prepare(`PRAGMA table_info(${table})`).all() as {
          name: string;
        }[]
      ).map((column) => column.name),
    );
    const missing = expectedColumns.filter(
      (column) => !actualColumns.has(column),
    );
    if (missing.length > 0) {
      throw new Error(
        `Worker cache schema is incompatible (${table} is missing ${missing.join(', ')}); rebuild the local cache`,
      );
    }
  }

  private requirePrimaryKey(table: string, expectedColumns: string[]) {
    const primaryKeyColumns = (
      this.getDatabase().prepare(`PRAGMA table_info(${table})`).all() as {
        name: string;
        pk: number;
      }[]
    )
      .filter((column) => column.pk > 0)
      .sort((left, right) => left.pk - right.pk)
      .map((column) => column.name);
    if (primaryKeyColumns.join(',') !== expectedColumns.join(',')) {
      throw new Error(
        `Worker cache schema is incompatible (${table} has an unexpected primary key); rebuild the local cache`,
      );
    }
  }

  private applyCacheMigration(name: string, apply: () => void) {
    const database = this.getDatabase();
    if (
      database
        .prepare('SELECT 1 FROM worker_cache_migration WHERE name = ?')
        .get(name)
    ) {
      return;
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      if (
        !database
          .prepare('SELECT 1 FROM worker_cache_migration WHERE name = ?')
          .get(name)
      ) {
        apply();
        database
          .prepare(
            'INSERT INTO worker_cache_migration (name, applied_at) VALUES (?, ?)',
          )
          .run(name, new Date().toISOString());
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  private addColumnIfMissing(
    table: string,
    column: string,
    definition: string,
  ) {
    const columns = this.getDatabase()
      .prepare(`PRAGMA table_info(${table})`)
      .all() as { name: string }[];
    if (!columns.some((item) => item.name === column)) {
      this.getDatabase().exec(
        `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`,
      );
    }
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

  isSqliteEventLogCache() {
    return this.eventLogCacheDriver === 'sqlite';
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
    if (this.eventLogCacheDriver === 'sqlite') {
      return this.getSqliteEventLogs(input);
    }
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
    if (this.eventLogCacheDriver === 'sqlite') {
      this.mergeSqliteEventLogs(eventLogs);
      return;
    }
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

  private getSqliteEventLogs(input: {
    platform: Platform;
    address: string;
    startedAt: Date;
    endedAt: Date;
  }): WorkerCachedEventLog[] {
    return this.getDatabase()
      .prepare(
        `SELECT address, date, block, log_index, contract_id, platform,
                transaction_hash, json_log, usd_pnl
         FROM perp_trading_event_log
         WHERE platform = ? AND address = ? AND date >= ? AND date < ?
         ORDER BY date, block, log_index, contract_id`,
      )
      .all(
        input.platform,
        input.address.toLowerCase(),
        input.startedAt.toISOString(),
        input.endedAt.toISOString(),
      )
      .map((row) => {
        const record = row as {
          address: string;
          date: string;
          block: number;
          log_index: number;
          contract_id: number;
          platform: Platform;
          transaction_hash: string;
          json_log: string;
          usd_pnl: number;
        };
        return {
          address: record.address,
          date: record.date,
          block: record.block,
          logIndex: record.log_index,
          contractId: record.contract_id,
          platform: record.platform,
          transactionHash: record.transaction_hash,
          jsonLog: record.json_log,
          usdPnl: record.usd_pnl,
        };
      });
  }

  private mergeSqliteEventLogs(eventLogs: WorkerCachedEventLog[]) {
    const database = this.getDatabase();
    database.exec('BEGIN');
    try {
      this.upsertSqliteEventLogs(eventLogs);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  private upsertSqliteEventLogs(eventLogs: WorkerCachedEventLog[]) {
    const database = this.getDatabase();
    const insert = database.prepare(
      `INSERT INTO perp_trading_event_log (
         contract_id, json_log, usd_pnl, block, log_index, transaction_hash,
         date, address, platform
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(contract_id, block, log_index) DO UPDATE SET
         json_log = excluded.json_log,
         usd_pnl = excluded.usd_pnl,
         transaction_hash = excluded.transaction_hash,
         date = excluded.date,
         address = excluded.address,
         platform = excluded.platform`,
    );
    for (const eventLog of eventLogs) {
      const date = new Date(eventLog.date);
      if (Number.isNaN(+date)) continue;
      insert.run(
        eventLog.contractId,
        eventLog.jsonLog,
        eventLog.usdPnl,
        eventLog.block,
        eventLog.logIndex,
        eventLog.transactionHash,
        date.toISOString(),
        eventLog.address.toLowerCase(),
        eventLog.platform,
      );
    }
  }

  commitSqlitePrebuildChunk(input: SqlitePrebuildChunkCommit) {
    if (!this.isSqliteEventLogCache()) {
      throw new Error('SQLite event-log cache is not enabled');
    }
    const database = this.getDatabase();
    database.exec('BEGIN IMMEDIATE');
    try {
      this.upsertSqliteEventLogs(input.eventLogs);
      this.savePrebuildTaskCheckpointInTransaction(
        input.taskId,
        input.platform,
        input.startedAt,
        input.endedAt,
        input.checkpoint,
      );
      if (input.completed) {
        this.markPlatformCoverageInTransaction(
          input.platform,
          input.startedAt,
          input.endedAt,
        );
        database
          .prepare('DELETE FROM prebuild_task_checkpoint WHERE task_id = ?')
          .run(input.taskId);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  getPrebuildTaskCheckpoint(
    taskId: string,
    platform: Platform,
    startedAt: Date,
    endedAt: Date,
  ): PrebuildTaskCheckpoint | null {
    const row = this.getDatabase()
      .prepare(
        `SELECT cursor_date, cursor_contract_id, cursor_block, cursor_log_index, done,
                records_processed, bytes_downloaded, total_records
         FROM prebuild_task_checkpoint
         WHERE task_id = ? AND platform = ? AND started_at = ? AND ended_at = ?`,
      )
      .get(taskId, platform, startedAt.toISOString(), endedAt.toISOString()) as
      | {
          cursor_date: string | null;
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
      row.cursor_date,
      row.cursor_contract_id,
      row.cursor_block,
      row.cursor_log_index,
    ].every((value) =>
      typeof value === 'string'
        ? !Number.isNaN(new Date(value).getTime())
        : Number.isSafeInteger(value),
    );
    return {
      cursor: hasCursor
        ? {
            date: row.cursor_date!,
            block: row.cursor_block!,
            logIndex: row.cursor_log_index!,
            contractId: row.cursor_contract_id!,
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
    this.savePrebuildTaskCheckpointInTransaction(
      taskId,
      platform,
      startedAt,
      endedAt,
      checkpoint,
    );
  }

  private savePrebuildTaskCheckpointInTransaction(
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
           cursor_date, cursor_contract_id, cursor_block, cursor_log_index, done,
           records_processed, bytes_downloaded, total_records, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           platform = excluded.platform,
           started_at = excluded.started_at,
           ended_at = excluded.ended_at,
           cursor_date = excluded.cursor_date,
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
        checkpoint.cursor?.date ?? null,
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
    database.exec('BEGIN');
    try {
      this.markPlatformCoverageInTransaction(platform, startedAt, endedAt);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  private markPlatformCoverageInTransaction(
    platform: Platform,
    startedAt: Date,
    endedAt: Date,
  ) {
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

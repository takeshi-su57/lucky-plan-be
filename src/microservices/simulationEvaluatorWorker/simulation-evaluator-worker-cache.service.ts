import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { promises as fs } from 'fs';
import { generateKeyPairSync, randomUUID } from 'crypto';
import { dirname, join } from 'path';

import { Platform } from 'generated/prisma/enums';
import { SIMULATION_EVALUATOR } from 'src/microservices/analyticsService/modules/simulationEvaluator/simulation-evaluator.constants';

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

@Injectable()
export class SimulationEvaluatorWorkerCacheService
  implements OnModuleInit, OnModuleDestroy
{
  private database?: DatabaseSync;
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
    `);
  }

  getWorkerIdentity() {
    const existing = this.database
      ?.prepare(
        'SELECT worker_id, public_key, private_key FROM worker_identity WHERE id = 1',
      )
      .get() as
      | { worker_id: string; public_key: string; private_key: string }
      | undefined;
    if (existing) {
      return {
        workerId: existing.worker_id,
        publicKey: existing.public_key,
        privateKey: existing.private_key,
      };
    }

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');

    const identity = {
      workerId: randomUUID(),
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      privateKey: privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    };
    this.database
      ?.prepare(
        'INSERT INTO worker_identity (id, worker_id, public_key, private_key) VALUES (1, ?, ?, ?)',
      )
      .run(identity.workerId, identity.publicKey, identity.privateKey);
    return identity;
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

  hasPlatformCoverage(platform: Platform, startedAt: Date, endedAt: Date) {
    const row = this.database
      ?.prepare(
        'SELECT 1 FROM platform_cache_coverage WHERE platform = ? AND started_at <= ? AND ended_at >= ? LIMIT 1',
      )
      .get(platform, startedAt.toISOString(), endedAt.toISOString());
    return Boolean(row);
  }

  markPlatformCoverage(platform: Platform, startedAt: Date, endedAt: Date) {
    this.database
      ?.prepare(
        'INSERT OR IGNORE INTO platform_cache_coverage (platform, started_at, ended_at) VALUES (?, ?, ?)',
      )
      .run(platform, startedAt.toISOString(), endedAt.toISOString());
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

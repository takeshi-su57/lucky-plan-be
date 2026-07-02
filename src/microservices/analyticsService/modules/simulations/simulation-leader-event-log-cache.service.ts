import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';

import { Platform } from 'generated/prisma/enums';

export type CachedLeaderEventLogRecord = {
  id: number;
  address: string;
  date: Date;
  block: number;
  contractId: number;
  platform: Platform;
  jsonLog: string;
};

type LeaderEventLogCacheMeta = {
  platform: Platform;
  address: string;
  filePath: string;
  cachedUntil?: Date;
  fetchedUntil: Date;
  count: number;
};

@Injectable()
export class SimulationLeaderEventLogCacheService {
  private readonly leaderEventLogCacheMeta = new Map<
    string,
    LeaderEventLogCacheMeta
  >();
  private readonly eventLogCacheDir = join(
    process.cwd(),
    '.cache',
    'simulation-leader-event-logs',
  );

  async clear() {
    this.leaderEventLogCacheMeta.clear();
    await fs.rm(this.eventLogCacheDir, { recursive: true, force: true });
    await fs.mkdir(this.eventLogCacheDir, { recursive: true });
  }

  getRefreshStartedAt(
    platform: Platform,
    address: string,
    fallbackStartedAt: Date,
  ) {
    const cacheMeta = this.leaderEventLogCacheMeta.get(
      this.getCacheKey(platform, address),
    );

    return (
      cacheMeta?.cachedUntil || cacheMeta?.fetchedUntil || fallbackStartedAt
    );
  }

  async updateCache(
    platform: Platform,
    address: string,
    freshRecords: CachedLeaderEventLogRecord[],
    scoringStartedAt: Date,
    fetchedUntil: Date,
  ) {
    const normalizedAddress = address.toLowerCase();
    const refreshStartedAt = this.getRefreshStartedAt(
      platform,
      normalizedAddress,
      scoringStartedAt,
    );
    const cacheMeta = this.leaderEventLogCacheMeta.get(
      this.getCacheKey(platform, normalizedAddress),
    );
    const cachedRecords = cacheMeta
      ? await this.readCachedEventLogs(cacheMeta.filePath)
      : [];
    const records = this.mergeEventLogRecords([
      ...cachedRecords,
      ...freshRecords,
    ]).filter(
      (record) =>
        record.date.getTime() >= scoringStartedAt.getTime() &&
        record.date.getTime() < fetchedUntil.getTime(),
    );

    await this.writeCachedEventLogs(
      platform,
      normalizedAddress,
      records,
      fetchedUntil,
    );

    return {
      refreshStartedAt,
      records,
    };
  }

  private getCacheKey(platform: Platform, address: string) {
    return `${platform}:${address.toLowerCase()}`;
  }

  private getCachePath(platform: Platform, address: string) {
    return join(this.eventLogCacheDir, `${platform}-${address}.json`);
  }

  private async readCachedEventLogs(filePath: string) {
    const raw = await fs.readFile(filePath, 'utf8');
    const records = JSON.parse(raw) as (Omit<
      CachedLeaderEventLogRecord,
      'date'
    > & {
      date: string;
    })[];

    return records.map((record) => ({
      ...record,
      date: new Date(record.date),
    }));
  }

  private async writeCachedEventLogs(
    platform: Platform,
    address: string,
    records: CachedLeaderEventLogRecord[],
    fetchedUntil: Date,
  ) {
    await fs.mkdir(this.eventLogCacheDir, { recursive: true });
    const filePath = this.getCachePath(platform, address);
    const temporaryPath = `${filePath}.tmp`;
    const latestRecord = records.reduce<CachedLeaderEventLogRecord | null>(
      (latest, record) =>
        !latest || record.date.getTime() > latest.date.getTime()
          ? record
          : latest,
      null,
    );

    await fs.writeFile(temporaryPath, JSON.stringify(records), 'utf8');
    await fs.rename(temporaryPath, filePath);
    this.leaderEventLogCacheMeta.set(this.getCacheKey(platform, address), {
      platform,
      address,
      filePath,
      cachedUntil: latestRecord?.date,
      fetchedUntil,
      count: records.length,
    });
  }

  private mergeEventLogRecords(records: CachedLeaderEventLogRecord[]) {
    const recordById = new Map<number, CachedLeaderEventLogRecord>();

    records.forEach((record) => {
      recordById.set(record.id, {
        ...record,
        address: record.address.toLowerCase(),
        date: new Date(record.date),
      });
    });

    return [...recordById.values()].sort((a, b) => {
      const addressComparison = a.address.localeCompare(b.address);

      if (addressComparison !== 0) {
        return addressComparison;
      }

      const dateComparison = a.date.getTime() - b.date.getTime();

      if (dateComparison !== 0) {
        return dateComparison;
      }

      const blockComparison = a.block - b.block;

      return blockComparison !== 0 ? blockComparison : a.id - b.id;
    });
  }
}

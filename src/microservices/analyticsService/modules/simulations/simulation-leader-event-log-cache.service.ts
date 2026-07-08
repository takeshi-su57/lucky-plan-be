import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';

import { Platform } from 'generated/prisma/enums';
import { PrismaService } from 'src/global/prisma.service';

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
};

type RegisteredResearchRange = {
  platform: Platform;
  startedAt: Date;
  endedAt: Date;
};

@Injectable()
export class SimulationLeaderEventLogCacheService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly leaderEventLogCacheMeta = new Map<
    string,
    LeaderEventLogCacheMeta
  >();
  private registeredResearchRange: RegisteredResearchRange | null = null;
  private readonly eventLogCacheDir = join(
    process.cwd(),
    '.cache',
    'simulation-leader-event-logs',
  );

  async clear() {
    this.leaderEventLogCacheMeta.clear();
    this.registeredResearchRange = null;
    await fs.rm(this.eventLogCacheDir, { recursive: true, force: true });
    await fs.mkdir(this.eventLogCacheDir, { recursive: true });
  }

  async registerResearchRange(
    platform: Platform,
    startedAt: Date,
    endedAt: Date,
  ) {
    await this.clear();
    this.registeredResearchRange = { platform, startedAt, endedAt };
  }

  async readLeaderEventLogs(
    platform: Platform,
    address: string,
    startedAt: Date,
    endedAt: Date,
  ) {
    const cacheMeta = this.leaderEventLogCacheMeta.get(
      this.getCacheKey(platform, address),
    );

    if (!cacheMeta) {
      const records = await this.fetchAndCacheLeaderEventLogs(
        platform,
        address,
      );

      return this.filterEventLogsByRange(records, startedAt, endedAt);
    }

    const records = await this.readCachedEventLogs(cacheMeta.filePath);

    return this.filterEventLogsByRange(records, startedAt, endedAt);
  }

  async countRecentEvents(
    platform: Platform,
    address: string,
    startedAt: Date,
    endedAt: Date,
  ) {
    const records = await this.readLeaderEventLogs(
      platform,
      address,
      startedAt,
      endedAt,
    );

    return records.length;
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

  private async fetchAndCacheLeaderEventLogs(
    platform: Platform,
    address: string,
  ) {
    const registeredRange = this.registeredResearchRange;
    const normalizedAddress = address.toLowerCase();

    if (!registeredRange || registeredRange.platform !== platform) {
      return [];
    }

    const records = await this.prisma.perpTradingEventLog.findMany({
      select: {
        id: true,
        address: true,
        date: true,
        block: true,
        contractId: true,
        platform: true,
        jsonLog: true,
      },
      where: {
        address: normalizedAddress,
        platform,
        date: {
          gte: registeredRange.startedAt,
          lt: registeredRange.endedAt,
        },
      },
      orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
    });

    const cachedRecords = records.map((record) => ({
      ...record,
      address: normalizedAddress,
      date: new Date(record.date),
    }));

    await this.writeCachedEventLogs(platform, normalizedAddress, cachedRecords);

    return cachedRecords;
  }

  private filterEventLogsByRange(
    records: CachedLeaderEventLogRecord[],
    startedAt: Date,
    endedAt: Date,
  ) {
    return records.filter(
      (record) =>
        record.date.getTime() >= startedAt.getTime() &&
        record.date.getTime() < endedAt.getTime(),
    );
  }

  private async writeCachedEventLogs(
    platform: Platform,
    address: string,
    records: CachedLeaderEventLogRecord[],
  ) {
    await fs.mkdir(this.eventLogCacheDir, { recursive: true });
    const filePath = this.getCachePath(platform, address);
    const temporaryPath = `${filePath}.tmp`;
    const orderedRecords = this.mergeEventLogRecords(records);

    await fs.writeFile(temporaryPath, JSON.stringify(orderedRecords), 'utf8');
    await fs.rename(temporaryPath, filePath);
    this.leaderEventLogCacheMeta.set(this.getCacheKey(platform, address), {
      platform,
      address,
      filePath,
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

import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';

import { Platform } from 'generated/prisma/enums';
import { PrismaService } from 'src/global/prisma.service';
import {
  compareEventLogOrder,
  getEventLogOrderBy,
  getEventLogSourceKey,
} from 'src/microservices/apiService/modules/trade-histories/event-log-identity.utils';

export type CachedLeaderEventLogRecord = {
  address: string;
  date: Date;
  block: number;
  logIndex: number;
  contractId: number;
  platform: Platform;
  jsonLog: string;
};

type LeaderEventLogCacheMeta = {
  platform: Platform;
  address: string;
  filePath: string;
};

const EVENT_LOG_PREBUILD_BATCH_SIZE = 1000;

export type EventLogPrebuildProgress = {
  completedAddressBatches: number;
  totalAddressBatches: number;
  completedAddresses: number;
  totalAddresses: number;
};

type EventLogPrebuildOptions = {
  onProgress?: (progress: EventLogPrebuildProgress) => Promise<void>;
};

@Injectable()
export class SimulationLeaderEventLogCacheService {
  constructor(private readonly prisma: PrismaService) {}

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

  async prebuildForResearch(
    platform: Platform,
    startedAt: Date,
    endedAt: Date,
    options: EventLogPrebuildOptions = {},
  ) {
    await this.clear();

    const leaderAddressGroups = await this.prisma.perpTradingEventLog.groupBy({
      by: ['address'],
      where: {
        platform,
        date: {
          gte: startedAt,
          lt: endedAt,
        },
      },
      orderBy: {
        address: 'asc',
      },
    });
    const leaderAddresses = [
      ...new Set(
        leaderAddressGroups.map((group) => group.address.toLowerCase()),
      ),
    ];
    const totalAddressBatches = Math.ceil(
      leaderAddresses.length / EVENT_LOG_PREBUILD_BATCH_SIZE,
    );

    for (
      let offset = 0;
      offset < leaderAddresses.length;
      offset += EVENT_LOG_PREBUILD_BATCH_SIZE
    ) {
      const label = `prebuilt from ${offset * EVENT_LOG_PREBUILD_BATCH_SIZE} to ${(offset + 1) * EVENT_LOG_PREBUILD_BATCH_SIZE}`;
      console.time(label);

      const addressBatch = leaderAddresses.slice(
        offset,
        offset + EVENT_LOG_PREBUILD_BATCH_SIZE,
      );

      console.time(`fetching from db : ${label}`);

      const records = await this.prisma.perpTradingEventLog.findMany({
        select: {
          address: true,
          date: true,
          block: true,
          logIndex: true,
          contractId: true,
          platform: true,
          jsonLog: true,
        },
        where: {
          address: { in: addressBatch },
          platform,
          date: {
            gte: startedAt,
            lt: endedAt,
          },
        },
        orderBy: getEventLogOrderBy(),
      });

      console.timeEnd(`fetching from db : ${label}`);

      const recordsByAddress = new Map<string, CachedLeaderEventLogRecord[]>();

      records.forEach((record) => {
        const normalizedAddress = record.address.toLowerCase();
        const addressRecords = recordsByAddress.get(normalizedAddress) ?? [];
        addressRecords.push({
          ...record,
          address: normalizedAddress,
          date: new Date(record.date),
        });
        recordsByAddress.set(normalizedAddress, addressRecords);
      });

      console.time(`writing to file : ${label}`);

      for (const address of addressBatch) {
        await this.writeCachedEventLogs(
          platform,
          address,
          recordsByAddress.get(address) ?? [],
        );
      }

      console.timeEnd(`writing to file : ${label}`);

      await options.onProgress?.({
        completedAddressBatches:
          Math.floor(offset / EVENT_LOG_PREBUILD_BATCH_SIZE) + 1,
        totalAddressBatches,
        completedAddresses: Math.min(
          offset + addressBatch.length,
          leaderAddresses.length,
        ),
        totalAddresses: leaderAddresses.length,
      });
    }
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
      return [];
    }

    const records = await this.readCachedEventLogs(cacheMeta.filePath);

    return this.filterEventLogsByRange(records, startedAt, endedAt);
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
    const recordById = new Map<string, CachedLeaderEventLogRecord>();

    records.forEach((record) => {
      recordById.set(getEventLogSourceKey(record), {
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

      return compareEventLogOrder(a, b);
    });
  }
}

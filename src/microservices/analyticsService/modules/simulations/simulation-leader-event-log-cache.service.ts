import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';

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

type LeaderEventLogCacheCoverage = {
  platform: Platform;
  startedAt: string;
  endedAt: string;
  version: 1;
};

type DateRange = { startedAt: Date; endedAt: Date };

const EVENT_LOG_PREBUILD_BATCH_SIZE = 1000;
const CACHE_METADATA_KEY_PREFIX = 'simulation-leader-event-log-cache:';

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
  private readonly eventLogCacheDir = join(
    process.cwd(),
    '.cache',
    'simulation-leader-event-logs',
  );

  constructor(private readonly prisma: PrismaService) {}

  async prebuildForResearch(
    platform: Platform,
    startedAt: Date,
    endedAt: Date,
    options: EventLogPrebuildOptions = {},
  ) {
    const coverage = await this.getCoverage(platform);
    const missingRanges = this.getMissingRanges(coverage, startedAt, endedAt);

    if (missingRanges.length === 0) {
      await options.onProgress?.({
        completedAddressBatches: 0,
        totalAddressBatches: 0,
        completedAddresses: 0,
        totalAddresses: 0,
      });
      return;
    }

    const leaderAddresses = await this.findLeaderAddresses(
      platform,
      missingRanges,
    );
    const totalAddressBatches = Math.ceil(
      leaderAddresses.length / EVENT_LOG_PREBUILD_BATCH_SIZE,
    );

    for (
      let offset = 0;
      offset < leaderAddresses.length;
      offset += EVENT_LOG_PREBUILD_BATCH_SIZE
    ) {
      const addressBatch = leaderAddresses.slice(
        offset,
        offset + EVENT_LOG_PREBUILD_BATCH_SIZE,
      );
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
          OR: missingRanges.map((range) => ({
            date: { gte: range.startedAt, lt: range.endedAt },
          })),
        },
        orderBy: getEventLogOrderBy(),
      });

      const recordsByObject = new Map<string, CachedLeaderEventLogRecord[]>();
      for (const record of records) {
        const normalizedAddress = record.address.toLowerCase();
        const normalizedRecord = {
          ...record,
          address: normalizedAddress,
          date: new Date(record.date),
        };
        const objectKey = this.getObjectKey(
          platform,
          normalizedAddress,
          record.date,
        );
        const objectRecords = recordsByObject.get(objectKey) ?? [];
        objectRecords.push(normalizedRecord);
        recordsByObject.set(objectKey, objectRecords);
      }

      for (const [objectKey, newRecords] of recordsByObject) {
        const existingRecords = await this.readCachedEventLogs(objectKey);
        await this.writeCachedEventLogs(objectKey, [
          ...existingRecords,
          ...newRecords,
        ]);
      }

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

    await this.saveCoverage(platform, coverage, startedAt, endedAt);
  }

  async readLeaderEventLogs(
    platform: Platform,
    address: string,
    startedAt: Date,
    endedAt: Date,
  ) {
    const coverage = await this.getCoverage(platform);
    if (
      !coverage ||
      startedAt < new Date(coverage.startedAt) ||
      endedAt > new Date(coverage.endedAt)
    ) {
      return [];
    }

    const normalizedAddress = address.toLowerCase();
    const records = await Promise.all(
      this.getMonthsInRange(startedAt, endedAt).map((month) =>
        this.readCachedEventLogs(
          this.getObjectKey(platform, normalizedAddress, month),
        ),
      ),
    );

    return this.filterEventLogsByRange(
      this.mergeEventLogRecords(records.flat()),
      startedAt,
      endedAt,
    );
  }

  private async findLeaderAddresses(platform: Platform, ranges: DateRange[]) {
    const groups = await Promise.all(
      ranges.map((range) =>
        this.prisma.perpTradingEventLog.groupBy({
          by: ['address'],
          where: {
            platform,
            date: { gte: range.startedAt, lt: range.endedAt },
          },
          orderBy: { address: 'asc' },
        }),
      ),
    );
    return [
      ...new Set(groups.flat().map((group) => group.address.toLowerCase())),
    ].sort();
  }

  private getMissingRanges(
    coverage: LeaderEventLogCacheCoverage | null,
    startedAt: Date,
    endedAt: Date,
  ): DateRange[] {
    if (!coverage) return [{ startedAt, endedAt }];

    const cachedStartedAt = new Date(coverage.startedAt);
    const cachedEndedAt = new Date(coverage.endedAt);
    const ranges: DateRange[] = [];
    if (startedAt < cachedStartedAt) {
      ranges.push({
        startedAt,
        endedAt: new Date(
          Math.min(endedAt.getTime(), cachedStartedAt.getTime()),
        ),
      });
    }
    if (endedAt > cachedEndedAt) {
      ranges.push({
        startedAt: new Date(
          Math.max(startedAt.getTime(), cachedEndedAt.getTime()),
        ),
        endedAt,
      });
    }
    return ranges.filter((range) => range.startedAt < range.endedAt);
  }

  private async getCoverage(platform: Platform) {
    const metadata = await this.prisma.metadata.findUnique({
      where: { key: this.getMetadataKey(platform) },
    });
    if (!metadata) return null;
    try {
      const coverage = JSON.parse(
        metadata.value,
      ) as LeaderEventLogCacheCoverage;
      return coverage.version === 1 && coverage.platform === platform
        ? coverage
        : null;
    } catch {
      return null;
    }
  }

  private async saveCoverage(
    platform: Platform,
    coverage: LeaderEventLogCacheCoverage | null,
    startedAt: Date,
    endedAt: Date,
  ) {
    const nextCoverage: LeaderEventLogCacheCoverage = {
      platform,
      startedAt: new Date(
        Math.min(
          startedAt.getTime(),
          coverage
            ? new Date(coverage.startedAt).getTime()
            : startedAt.getTime(),
        ),
      ).toISOString(),
      endedAt: new Date(
        Math.max(
          endedAt.getTime(),
          coverage ? new Date(coverage.endedAt).getTime() : endedAt.getTime(),
        ),
      ).toISOString(),
      version: 1,
    };
    await this.prisma.metadata.upsert({
      where: { key: this.getMetadataKey(platform) },
      create: {
        key: this.getMetadataKey(platform),
        value: JSON.stringify(nextCoverage),
      },
      update: { value: JSON.stringify(nextCoverage) },
    });
  }

  private getMetadataKey(platform: Platform) {
    return `${CACHE_METADATA_KEY_PREFIX}${platform}`;
  }

  private getObjectKey(platform: Platform, address: string, date: Date) {
    return `${platform}/${date.getUTCFullYear()}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${address.toLowerCase()}.history`;
  }

  private getMonthsInRange(startedAt: Date, endedAt: Date) {
    const months: Date[] = [];
    const month = new Date(
      Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), 1),
    );
    while (month < endedAt) {
      months.push(new Date(month));
      month.setUTCMonth(month.getUTCMonth() + 1);
    }
    return months;
  }

  private async readCachedEventLogs(objectKey: string) {
    try {
      const raw = await fs.readFile(this.getFilePath(objectKey), 'utf8');
      const records = JSON.parse(raw) as (Omit<
        CachedLeaderEventLogRecord,
        'date'
      > & { date: string })[];
      return records.map((record) => ({
        ...record,
        date: new Date(record.date),
      }));
    } catch (error: any) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  private filterEventLogsByRange(
    records: CachedLeaderEventLogRecord[],
    startedAt: Date,
    endedAt: Date,
  ) {
    return records.filter(
      (record) => record.date >= startedAt && record.date < endedAt,
    );
  }

  private async writeCachedEventLogs(
    objectKey: string,
    records: CachedLeaderEventLogRecord[],
  ) {
    const orderedRecords = this.mergeEventLogRecords(records);
    const filePath = this.getFilePath(objectKey);
    const temporaryPath = `${filePath}.tmp`;
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(temporaryPath, JSON.stringify(orderedRecords), 'utf8');
    await fs.rename(temporaryPath, filePath);
  }

  private getFilePath(objectKey: string) {
    return join(this.eventLogCacheDir, ...objectKey.split('/'));
  }

  private mergeEventLogRecords(records: CachedLeaderEventLogRecord[]) {
    const recordById = new Map<string, CachedLeaderEventLogRecord>();
    records.forEach((record) =>
      recordById.set(getEventLogSourceKey(record), {
        ...record,
        address: record.address.toLowerCase(),
        date: new Date(record.date),
      }),
    );
    return [...recordById.values()].sort((a, b) => compareEventLogOrder(a, b));
  }
}

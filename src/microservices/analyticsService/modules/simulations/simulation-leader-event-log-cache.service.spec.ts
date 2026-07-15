import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'generated/prisma/enums';

import { SimulationLeaderEventLogCacheService } from './simulation-leader-event-log-cache.service';

describe('SimulationLeaderEventLogCacheService', () => {
  let cacheDir: string | null = null;

  afterEach(() => {
    if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
    cacheDir = null;
  });

  it('persists monthly leader histories locally and reuses covered ranges', async () => {
    const localCacheDir = mkdtempSync(
      join(tmpdir(), 'leader-event-log-cache-'),
    );
    cacheDir = localCacheDir;
    let metadata: { key: string; value: string } | null = null;
    const records = [
      {
        address: '0xLeaderA',
        platform: Platform.GNS,
        date: new Date('2026-02-28T23:00:00.000Z'),
        block: 1,
        logIndex: 1,
        contractId: 11,
        jsonLog: '{}',
      },
      {
        address: '0xLeaderA',
        platform: Platform.GNS,
        date: new Date('2026-03-02T00:00:00.000Z'),
        block: 2,
        logIndex: 1,
        contractId: 11,
        jsonLog: '{}',
      },
    ];
    const prisma = {
      metadata: {
        findUnique: jest.fn(async () => metadata),
        upsert: jest.fn(async ({ create }) => (metadata = create)),
      },
      perpTradingEventLog: {
        groupBy: jest.fn(async ({ where }) =>
          records
            .filter(
              (record) =>
                record.platform === where.platform &&
                record.date >= where.date.gte &&
                record.date < where.date.lt,
            )
            .map((record) => ({ address: record.address })),
        ),
        findMany: jest.fn(async ({ where }) =>
          records.filter(
            (record) =>
              where.address.in.includes(record.address.toLowerCase()) &&
              record.platform === where.platform &&
              where.OR.some(
                ({ date }: { date: { gte: Date; lt: Date } }) =>
                  record.date >= date.gte && record.date < date.lt,
              ),
          ),
        ),
      },
    };
    const service = new SimulationLeaderEventLogCacheService(prisma as never);
    (service as any).eventLogCacheDir = localCacheDir;

    await service.prebuildForResearch(
      Platform.GNS,
      new Date('2026-02-01T00:00:00.000Z'),
      new Date('2026-04-01T00:00:00.000Z'),
    );

    expect(
      existsSync(join(localCacheDir, 'GNS', '2026', '02', '0xleadera.history')),
    ).toBe(true);
    expect(
      existsSync(join(localCacheDir, 'GNS', '2026', '03', '0xleadera.history')),
    ).toBe(true);
    expect(metadata).toEqual({
      key: 'simulation-leader-event-log-cache:GNS',
      value: JSON.stringify({
        platform: Platform.GNS,
        startedAt: '2026-02-01T00:00:00.000Z',
        endedAt: '2026-04-01T00:00:00.000Z',
        version: 1,
      }),
    });

    const cachedRecords = await service.readLeaderEventLogs(
      Platform.GNS,
      '0xLeaderA',
      new Date('2026-02-01T00:00:00.000Z'),
      new Date('2026-04-01T00:00:00.000Z'),
    );
    expect(cachedRecords.map((record) => record.block)).toEqual([1, 2]);

    await service.prebuildForResearch(
      Platform.GNS,
      new Date('2026-02-02T00:00:00.000Z'),
      new Date('2026-03-31T00:00:00.000Z'),
    );
    expect(prisma.perpTradingEventLog.findMany).toHaveBeenCalledTimes(1);
  });

  it('only queries and adds the uncovered sides of a platform range', async () => {
    const metadata = {
      key: 'simulation-leader-event-log-cache:GNS',
      value: JSON.stringify({
        platform: Platform.GNS,
        startedAt: '2026-03-01T00:00:00.000Z',
        endedAt: '2026-04-01T00:00:00.000Z',
        version: 1,
      }),
    };
    const prisma = {
      metadata: {
        findUnique: jest.fn(async () => metadata),
        upsert: jest.fn(async () => metadata),
      },
      perpTradingEventLog: {
        groupBy: jest.fn(async () => []),
        findMany: jest.fn(async () => []),
      },
    };
    const service = new SimulationLeaderEventLogCacheService(prisma as never);

    await service.prebuildForResearch(
      Platform.GNS,
      new Date('2026-02-01T00:00:00.000Z'),
      new Date('2026-05-01T00:00:00.000Z'),
    );

    expect(prisma.perpTradingEventLog.groupBy).toHaveBeenCalledTimes(2);
    expect(
      (prisma.perpTradingEventLog.groupBy as any).mock.calls[0][0],
    ).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date('2026-02-01T00:00:00.000Z'),
            lt: new Date('2026-03-01T00:00:00.000Z'),
          },
        }),
      }),
    );
    expect(
      (prisma.perpTradingEventLog.groupBy as any).mock.calls[1][0],
    ).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          date: {
            gte: new Date('2026-04-01T00:00:00.000Z'),
            lt: new Date('2026-05-01T00:00:00.000Z'),
          },
        }),
      }),
    );
  });
});

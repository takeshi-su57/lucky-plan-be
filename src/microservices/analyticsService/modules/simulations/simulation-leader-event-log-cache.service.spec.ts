import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'generated/prisma/enums';

import { SimulationLeaderEventLogCacheService } from './simulation-leader-event-log-cache.service';

describe('SimulationLeaderEventLogCacheService', () => {
  it('registers a research range and lazily caches per-address event logs', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'leader-event-log-cache-'));
    const records = [
      {
        id: 3,
        address: '0xLeaderB',
        platform: Platform.GNS,
        date: new Date('2026-03-03T00:00:00.000Z'),
        block: 3,
        contractId: 11,
        jsonLog: '{}',
      },
      {
        id: 2,
        address: '0xLeaderA',
        platform: Platform.GNS,
        date: new Date('2026-03-02T00:00:00.000Z'),
        block: 2,
        contractId: 11,
        jsonLog: '{}',
      },
      {
        id: 1,
        address: '0xLeaderA',
        platform: Platform.GNS,
        date: new Date('2026-03-01T00:00:00.000Z'),
        block: 1,
        contractId: 11,
        jsonLog: '{}',
      },
    ];
    const prisma = {
      perpTradingEventLog: {
        findMany: jest.fn(async ({ where }: any) =>
          records.filter(
            (record) =>
              record.address.toLowerCase() === where.address &&
              record.platform === where.platform &&
              record.date.getTime() >= where.date.gte.getTime() &&
              record.date.getTime() < where.date.lt.getTime(),
          ),
        ),
      },
    };
    const service = new SimulationLeaderEventLogCacheService(prisma as never);
    (service as any).eventLogCacheDir = cacheDir;

    try {
      await service.registerResearchRange(
        Platform.GNS,
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-03-04T00:00:00.000Z'),
      );

      expect(prisma.perpTradingEventLog.findMany).not.toHaveBeenCalled();

      const firstRead = await service.readLeaderEventLogs(
        Platform.GNS,
        '0xLeaderA',
        new Date('2026-03-01T12:00:00.000Z'),
        new Date('2026-03-03T00:00:00.000Z'),
      );
      const secondRead = await service.readLeaderEventLogs(
        Platform.GNS,
        '0xLeaderA',
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-03-02T12:00:00.000Z'),
      );

      expect(firstRead).toEqual([
        expect.objectContaining({ id: 2 }),
      ]);
      expect(secondRead).toEqual([
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 2 }),
      ]);
      expect(prisma.perpTradingEventLog.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.perpTradingEventLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            address: '0xleadera',
            platform: Platform.GNS,
            date: {
              gte: new Date('2026-03-01T00:00:00.000Z'),
              lt: new Date('2026-03-04T00:00:00.000Z'),
            },
          }),
          orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(existsSync(join(cacheDir, 'GNS-0xleadera.json'))).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

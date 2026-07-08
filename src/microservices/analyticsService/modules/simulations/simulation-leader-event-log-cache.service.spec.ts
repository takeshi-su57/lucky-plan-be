import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'generated/prisma/enums';

import { SimulationLeaderEventLogCacheService } from './simulation-leader-event-log-cache.service';

describe('SimulationLeaderEventLogCacheService', () => {
  it('rebuilds a research cache into per-address files and reads windowed records', async () => {
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
        groupBy: jest.fn(async (..._args: unknown[]) => [
          { address: '0xLeaderA' },
          { address: '0xLeaderB' },
        ]),
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
      await service.rebuildForResearch(
        Platform.GNS,
        new Date('2026-03-01T00:00:00.000Z'),
        new Date('2026-03-04T00:00:00.000Z'),
      );

      const recordsForLeader = await service.readLeaderEventLogs(
        Platform.GNS,
        '0xLeaderA',
        new Date('2026-03-01T12:00:00.000Z'),
        new Date('2026-03-03T00:00:00.000Z'),
      );

      expect(recordsForLeader).toEqual([
        expect.objectContaining({ id: 2 }),
      ]);
      expect(prisma.perpTradingEventLog.groupBy).toHaveBeenCalledWith({
        by: ['address'],
        where: {
          platform: Platform.GNS,
          date: {
            gte: new Date('2026-03-01T00:00:00.000Z'),
            lt: new Date('2026-03-04T00:00:00.000Z'),
          },
        },
        orderBy: {
          address: 'asc',
        },
      });
      expect(prisma.perpTradingEventLog.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.perpTradingEventLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            address: '0xleadera',
            platform: Platform.GNS,
          }),
          orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
        }),
      );
      expect(service.getLastEventAt(Platform.GNS, '0xLeaderA')).toEqual(
        new Date('2026-03-02T00:00:00.000Z'),
      );
      expect(existsSync(join(cacheDir, 'GNS-0xleadera.json'))).toBe(true);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { describe, expect, it } from '@jest/globals';
import { Platform } from 'generated/prisma/enums';

import { SimulationLeaderEventLogCacheService } from './simulation-leader-event-log-cache.service';

describe('SimulationLeaderEventLogCacheService', () => {
  it('merges cached and fresh event logs, deduplicates by id, and keeps the scoring window', async () => {
    const cacheDir = mkdtempSync(join(tmpdir(), 'leader-event-log-cache-'));
    const service = new SimulationLeaderEventLogCacheService();
    (service as any).eventLogCacheDir = cacheDir;
    const scoringStartedAt = new Date('2026-01-01T00:00:00.000Z');
    const before = new Date('2026-04-02T00:00:00.000Z');
    const cachedRecord = {
      id: 1,
      address: '0xleader',
      platform: Platform.GNS,
      date: new Date('2026-03-01T00:00:00.000Z'),
      block: 1,
      contractId: 11,
      jsonLog: '{}',
    };
    const staleRecord = {
      ...cachedRecord,
      id: 0,
      date: new Date('2025-12-31T00:00:00.000Z'),
    };
    const newRecord = {
      ...cachedRecord,
      id: 2,
      date: new Date('2026-03-02T00:00:00.000Z'),
      block: 2,
    };

    try {
      await service.updateCache(
        Platform.GNS,
        '0xLeader',
        [staleRecord, cachedRecord],
        scoringStartedAt,
        before,
      );

      const result = await service.updateCache(
        Platform.GNS,
        '0xLeader',
        [cachedRecord, newRecord],
        scoringStartedAt,
        before,
      );

      expect(result.refreshStartedAt).toEqual(cachedRecord.date);
      expect(result.records).toEqual([
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 2 }),
      ]);
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });
});

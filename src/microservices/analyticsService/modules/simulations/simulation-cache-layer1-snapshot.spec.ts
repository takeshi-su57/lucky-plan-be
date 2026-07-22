import { describe, expect, it } from '@jest/globals';
import { BotMode, Platform } from 'generated/prisma/enums';

import { PerpTradeHistoryOperation } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { SimulationCacheService } from './simulation-cache.service';

describe('SimulationCacheService Layer 1 snapshots', () => {
  it('persists a leader position even when the source Layer 2 configuration rejects it', () => {
    const service = new SimulationCacheService({} as never, {} as never);
    const getSnapshotIds = (
      service as unknown as {
        getCacheableSourceEventLogIds: (
          bot: unknown,
          histories: unknown[],
        ) => Set<number>;
      }
    ).getCacheableSourceEventLogIds.bind(service);
    const startedAt = new Date('2026-01-01T00:00:00.000Z');
    const histories = [
      {
        id: 101,
        contractId: 1,
        positionKey: 'position-1',
        operation: PerpTradeHistoryOperation.OPEN,
        date: new Date('2026-01-01T01:00:00.000Z'),
        collateralInUsd: 10,
        sizeInUsd: 100,
        leverage: 10,
      },
      {
        id: 102,
        contractId: 1,
        positionKey: 'position-1',
        operation: PerpTradeHistoryOperation.CLOSE,
        date: new Date('2026-01-01T02:00:00.000Z'),
      },
    ];

    const ids = getSnapshotIds(
      {
        startedAt,
        stoppedAt: new Date('2026-01-02T00:00:00.000Z'),
        leaderPlatform: Platform.GNS,
        mode: BotMode.Default,
        ratio: 1,
        minCollateral: 1_000,
        maxCollateral: 2_000,
        minSize: 10_000,
        maxSize: 20_000,
        minLeverage: 30,
        maxLeverage: 40,
      },
      histories,
    );

    expect([...ids]).toEqual([101, 102]);
  });
});

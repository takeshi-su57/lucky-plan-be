import { describe, expect, it } from '@jest/globals';

import {
  mapSimulationBotDetailsWithCache,
  mapSimulationBotWithCache,
} from './simulation-cache.mapper';

describe('simulation cache mapper', () => {
  it('maps bot cache fields into simulation bot details shape', () => {
    const result = mapSimulationBotWithCache({
      id: 1,
      leaderAddress: '0xabc',
      ratio: 1,
      maxLeverage: 10,
      simulationPlanId: 11,
      leaderPlatform: 'GNS',
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
      stoppedAt: new Date('2026-05-05T00:00:00.000Z'),
      mode: 'Default',
      openedPositions: 99,
      totalPositions: 99,
      totalPnl: 99,
      maxDuration: 99,
      avgDuration: 99,
      avgPnl: 99,
      avgPositivePnl: 99,
      avgNegativePnl: 99,
      avgSize: 99,
      avgCollateral: 99,
      avgPnlPercentageByCollateral: 99,
      avgPnlPercentageBySize: 99,
      avgLeverage: 99,
      cache: {
        openedPositions: 2,
        totalPositions: 3,
        totalLeaderPnl: 4,
        maxDuration: 5,
        avgDuration: 6,
        avgPnl: 7,
        avgPositivePnl: 8,
        avgNegativePnl: 9,
        avgSize: 10,
        avgCollateral: 11,
        avgPnlPercentageBySize: 12,
        avgPnlPercentageByCollateral: 13,
        avgLeverage: 14,
      },
    });

    expect(result.openedPositions).toBe(2);
    expect(result.totalPositions).toBe(3);
    expect(result.totalPnl).toBe(4);
    expect(result.maxDuration).toBe(5);
    expect(result.avgDuration).toBe(6);
    expect(result.avgPnl).toBe(7);
    expect(result.avgPositivePnl).toBe(8);
    expect(result.avgNegativePnl).toBe(9);
    expect(result.avgSize).toBe(10);
    expect(result.avgCollateral).toBe(11);
    expect(result.avgPnlPercentageBySize).toBe(12);
    expect(result.avgPnlPercentageByCollateral).toBe(13);
    expect(result.avgLeverage).toBe(14);
  });

  it('rehydrates cached positions for simulation bot details', () => {
    const result = mapSimulationBotDetailsWithCache({
      id: 1,
      leaderAddress: '0xabc',
      ratio: 1,
      maxLeverage: 10,
      simulationPlanId: 11,
      leaderPlatform: 'GNS',
      startedAt: new Date('2026-05-01T00:00:00.000Z'),
      stoppedAt: new Date('2026-05-05T00:00:00.000Z'),
      mode: 'Default',
      openedPositions: 99,
      totalPositions: 99,
      totalPnl: 99,
      maxDuration: 99,
      avgDuration: 99,
      avgPnl: 99,
      avgPositivePnl: 99,
      avgNegativePnl: 99,
      avgSize: 99,
      avgCollateral: 99,
      avgPnlPercentageByCollateral: 99,
      avgPnlPercentageBySize: 99,
      avgLeverage: 99,
      cache: {
        openedPositions: 2,
        totalPositions: 3,
        totalLeaderPnl: 4,
        maxDuration: 5,
        avgDuration: 6,
        avgPnl: 7,
        avgPositivePnl: 8,
        avgNegativePnl: 9,
        avgSize: 10,
        avgCollateral: 11,
        avgPnlPercentageBySize: 12,
        avgPnlPercentageByCollateral: 13,
        avgLeverage: 14,
        positionsJson:
          '[{"histories":[{"leader":{"id":1},"follower":{"id":-1}}],"leaderPnl":4,"followerPnl":3}]',
      },
    } as any);

    expect(result.positions).toEqual([
      {
        histories: [
          {
            leader: { id: 1 },
            follower: { id: -1 },
          },
        ],
        leaderPnl: 4,
        followerPnl: 3,
      },
    ]);
  });
});

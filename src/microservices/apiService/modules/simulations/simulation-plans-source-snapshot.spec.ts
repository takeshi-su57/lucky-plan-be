import { describe, expect, it, jest } from '@jest/globals';
import { BotMode, Platform } from 'generated/prisma/enums';

import { SimulationPlansService } from './simulation-plans.service';

jest.mock('src/web3/utils', () => ({
  getWeb3Info: () => ({
    eventToPerpTradeHistory: () => ({ operation: 'OPEN' }),
  }),
}));

const emptySummary = {
  positions: [],
  openedPositions: 0,
  totalPositions: 0,
  totalPnl: 0,
  maxDuration: 0,
  avgDuration: 0,
  avgPnl: 0,
  avgPositivePnl: 0,
  avgNegativePnl: 0,
  avgSize: 0,
  avgCollateral: 0,
  avgPnlPercentageBySize: 0,
  avgPnlPercentageByCollateral: 0,
  avgLeverage: 0,
};

function makeBot(sourceCache: unknown) {
  return {
    id: 2,
    leaderAddress: '0xleader',
    leaderPlatform: Platform.GNS,
    simulationPlanId: 2,
    sourceSimulationBotId: 1,
    sourceSimulationBot: { cache: sourceCache },
    startedAt: new Date('2026-01-01'),
    stoppedAt: new Date('2026-01-02'),
    mode: BotMode.Reversed,
    ratio: 0.5,
    score: 0.8,
    minCollateral: 0,
    maxCollateral: 100,
    minSize: 0,
    maxSize: 1000,
    minLeverage: 0,
    maxLeverage: 50,
    leaderExecutionCollateral: [],
    leaderExecutionSize: [],
    leaderExecutionLeverage: [],
    followerRiskSize: [],
    followerRiskCollateral: [],
  };
}

function makeService(bot: ReturnType<typeof makeBot>) {
  const liveFindMany = jest.fn();
  const prisma = {
    simulationPlan: {
      findUnique: jest.fn(async () => ({
        id: 2,
        title: 'variant',
        description: 'variant',
        startAt: new Date('2026-01-01'),
        endAt: new Date('2026-01-02'),
        cursor: new Date('2026-01-02'),
        simulationId: 2,
        openedPositions: 0,
        totalPositions: 0,
        totalLeaderPnl: 0,
        totalFollowerPnl: 0,
        simulationBots: [bot],
      })),
    },
    contract: {
      findMany: jest.fn(async () => [
        {
          id: 1,
          platform: Platform.GNS,
          version: 'v1',
          chainId: 1,
        },
      ]),
    },
    perpTradingEventLog: { findMany: liveFindMany },
  };
  const eventLogsService = {
    convertToPerpTradePositionsWithSummary: jest.fn(() => emptySummary),
  };

  return {
    liveFindMany,
    service: new SimulationPlansService(
      prisma as never,
      eventLogsService as never,
    ),
  };
}

describe('SimulationPlansService source snapshots', () => {
  it('recalculates from the persisted source event snapshot without querying live logs', async () => {
    const sourceEvent = {
      id: 1,
      sourceEventLogKey: '1:10:0',
      contractId: 1,
      address: '0xleader',
      platform: Platform.GNS,
      block: 10,
      logIndex: 0,
      transactionHash: '0xtx',
      date: new Date('2026-01-01'),
      jsonLog: '{}',
      usdPnl: 0,
    };
    const { service, liveFindMany } = makeService(
      makeBot({
        completed: true,
        eventSnapshotVersion: 2,
        eventLogs: [sourceEvent],
      }),
    );

    await service.calculateSimulationPlanDetails(2, {
      persistSummary: false,
      eventSource: 'sourceSnapshot',
    });

    expect(liveFindMany).not.toHaveBeenCalled();
  });

  it('does not fall back to live logs when the source snapshot is missing', async () => {
    const { service, liveFindMany } = makeService(makeBot(null));

    await expect(
      service.calculateSimulationPlanDetails(2, {
        persistSummary: false,
        eventSource: 'sourceSnapshot',
      }),
    ).rejects.toThrow('Source snapshot is unavailable');
    expect(liveFindMany).not.toHaveBeenCalled();
  });

  it('accepts an empty completed version-2 source snapshot', async () => {
    const { service, liveFindMany } = makeService(
      makeBot({ completed: true, eventSnapshotVersion: 2, eventLogs: [] }),
    );

    const details = await service.calculateSimulationPlanDetails(2, {
      persistSummary: false,
      eventSource: 'sourceSnapshot',
    });

    expect(details.simulationBots[0].positions).toEqual([]);
    expect(liveFindMany).not.toHaveBeenCalled();
  });
});

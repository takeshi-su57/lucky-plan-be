import { Injectable } from '@nestjs/common';
import {
  Contract,
  PerpTradingEventLog,
  SimulationBot,
  SimulationBotCache,
} from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { getWeb3Info } from 'src/web3/utils';

import { EventLogsService } from 'src/microservices/apiService/modules/trade-histories/event-logs.service';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import {
  getEventLogOrderBy,
  getEventLogSourceKey,
  getEventLogStableId,
} from 'src/microservices/apiService/modules/trade-histories/event-log-identity.utils';
import { simulateFollowerPositions } from 'src/microservices/apiService/modules/simulations/simulation-position-execution';
import {
  buildRealizedEquityCurve,
  mergeRealizedEquityCurves,
  RealizedEquityPoint,
} from './simulation-equity-curve';

type SimulationBotWithContract = SimulationBot & {
  leaderContracts: Pick<
    Contract,
    'id' | 'platform' | 'version' | 'chainId' | 'address'
  >[];
  cache?: SimulationBotCache | null;
};

type CachedEventLogRecord = Pick<
  PerpTradingEventLog,
  | 'address'
  | 'contractId'
  | 'platform'
  | 'jsonLog'
  | 'usdPnl'
  | 'block'
  | 'logIndex'
  | 'transactionHash'
  | 'date'
> & {
  sourceEventLogKey?: string;
};

@Injectable()
export class SimulationCacheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogsService: EventLogsService,
  ) {}

  async ensureSimulationPlanCache(simulationPlanId: number) {
    return this.prisma.simulationPlanCache.upsert({
      where: { simulationPlanId },
      update: {},
      create: { simulationPlanId },
    });
  }

  async ensureSimulationBotCache(simulationBotId: number) {
    return this.prisma.simulationBotCache.upsert({
      where: { simulationBotId },
      update: {},
      create: { simulationBotId },
    });
  }

  async appendNewEventLogsForBot(
    cacheId: number,
    bot: SimulationBotWithContract,
  ) {
    const cachedLogs = await this.prisma.simulationBotCachedEventLog.findMany({
      where: { simulationBotCacheId: cacheId },
      orderBy: getEventLogOrderBy(),
    });
    const existingLast = cachedLogs.at(-1);

    const newLogs = await this.prisma.perpTradingEventLog.findMany({
      where: {
        address: bot.leaderAddress.toLowerCase(),
        platform: bot.leaderPlatform,
        ...(existingLast
          ? { date: { gte: existingLast.date } }
          : {
              date: {
                gte: bot.startedAt,
              },
            }),
      },
      orderBy: getEventLogOrderBy(),
    });

    if (newLogs.length === 0) {
      return { count: 0 };
    }

    return this.appendProvidedEventLogsForBot(cacheId, bot, newLogs);
  }

  async appendProvidedEventLogsForBot(
    cacheId: number,
    bot: SimulationBotWithContract,
    newLogs: PerpTradingEventLog[],
  ) {
    if (newLogs.length === 0) return { count: 0 };
    const cachedLogs = await this.prisma.simulationBotCachedEventLog.findMany({
      where: { simulationBotCacheId: cacheId },
      orderBy: getEventLogOrderBy(),
    });

    const cachedHistories =
      cachedLogs.length > 0
        ? this.buildHistoriesFromCachedLogs(
            bot as SimulationBotWithContract,
            cachedLogs,
          )
        : [];
    const newLogRecords = newLogs.map((log) =>
      this.mapSourceLogToCachedRecord(cacheId, log),
    );
    const newHistories = this.buildHistoriesFromCachedLogs(
      bot as SimulationBotWithContract,
      newLogRecords,
    );
    const cacheableSourceEventLogIds = this.getCacheableSourceEventLogIds(bot, [
      ...cachedHistories,
      ...newHistories,
    ]);

    if (cacheableSourceEventLogIds.size === 0) {
      return { count: 0 };
    }

    const cacheableLogRecords = newLogRecords.filter((record) => {
      return cacheableSourceEventLogIds.has(getEventLogStableId(record));
    });

    if (cacheableLogRecords.length === 0) {
      return { count: 0 };
    }

    return this.prisma.simulationBotCachedEventLog.createMany({
      data: cacheableLogRecords,
      skipDuplicates: true,
    });
  }

  private mapSourceLogToCachedRecord(
    cacheId: number,
    log: PerpTradingEventLog,
  ) {
    return {
      simulationBotCacheId: cacheId,
      sourceEventLogKey: getEventLogSourceKey(log),
      contractId: log.contractId,
      address: log.address,
      platform: log.platform,
      block: log.block,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash,
      date: log.date,
      jsonLog: log.jsonLog,
      usdPnl: log.usdPnl,
    };
  }

  private getHistoryPositionKey(history: PerpTradeHistory) {
    return `${history.contractId}:${history.positionKey}`;
  }

  private isOpenedDuringBotLifetime(
    bot: Pick<SimulationBot, 'startedAt' | 'stoppedAt'>,
    history: PerpTradeHistory,
  ) {
    return (
      history.operation === PerpTradeHistoryOperation.OPEN &&
      history.date >= bot.startedAt &&
      (!bot.stoppedAt || history.date < bot.stoppedAt)
    );
  }

  private sortHistoriesByEventOrder(histories: PerpTradeHistory[]) {
    return [...histories].sort((a, b) => {
      const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();

      if (dateDiff !== 0) {
        return dateDiff;
      }

      return a.id - b.id;
    });
  }

  private getHistoriesGroupedByPositionKey(histories: PerpTradeHistory[]) {
    const groupedByPositionKey = new Map<string, PerpTradeHistory[]>();

    for (const history of this.sortHistoriesByEventOrder(histories)) {
      const positionKey = this.getHistoryPositionKey(history);
      const existing = groupedByPositionKey.get(positionKey);

      if (existing) {
        existing.push(history);
      } else {
        groupedByPositionKey.set(positionKey, [history]);
      }
    }

    return groupedByPositionKey;
  }

  private getCacheableSourceEventLogIds(
    bot: SimulationBot,
    histories: PerpTradeHistory[],
  ) {
    const sourceEventLogIds = new Set<number>();

    for (const positionHistories of this.getHistoriesGroupedByPositionKey(
      histories,
    ).values()) {
      for (let i = 0; i < positionHistories.length; i++) {
        const history = positionHistories[i];

        if (!this.isOpenedDuringBotLifetime(bot, history)) {
          continue;
        }

        for (let j = i; j < positionHistories.length; j++) {
          const nextHistory = positionHistories[j];

          if (
            j > i &&
            nextHistory.operation === PerpTradeHistoryOperation.OPEN
          ) {
            break;
          }

          sourceEventLogIds.add(nextHistory.id);

          if (nextHistory.operation === PerpTradeHistoryOperation.CLOSE) {
            break;
          }
        }
      }
    }

    return sourceEventLogIds;
  }

  isBotCacheComplete(
    bot: Pick<SimulationBot, 'startedAt' | 'stoppedAt'>,
    histories: PerpTradeHistory[],
  ) {
    for (const positionHistories of this.getHistoriesGroupedByPositionKey(
      histories,
    ).values()) {
      for (let i = 0; i < positionHistories.length; i++) {
        const history = positionHistories[i];

        if (!this.isOpenedDuringBotLifetime(bot, history)) {
          continue;
        }

        let closed = false;

        for (let j = i + 1; j < positionHistories.length; j++) {
          const nextHistory = positionHistories[j];

          if (nextHistory.operation === PerpTradeHistoryOperation.OPEN) {
            break;
          }

          if (nextHistory.operation === PerpTradeHistoryOperation.CLOSE) {
            closed = true;
            break;
          }
        }

        if (!closed) {
          return false;
        }
      }
    }

    return true;
  }

  buildHistoriesFromCachedLogs(
    bot: SimulationBotWithContract,
    cachedLogs: CachedEventLogRecord[],
  ): PerpTradeHistory[] {
    const contractById = new Map(
      bot.leaderContracts.map((contract) => [contract.id, contract]),
    );

    return cachedLogs
      .map((record) => {
        const contract = contractById.get(record.contractId);

        if (!contract) {
          return null;
        }

        const history = getWeb3Info(
          contract.platform,
          contract.version,
        ).eventToPerpTradeHistory(
          contract.chainId,
          JSON.parse(record.jsonLog) as never,
          contract.address,
        );

        return history
          ? {
              ...history,
              id: getEventLogStableId(record),
              date: record.date,
              chainId: contract.chainId,
              contractId: record.contractId,
              platform: record.platform,
            }
          : null;
      })
      .filter((item): item is PerpTradeHistory => !!item);
  }

  buildBotSummaryFromCachedLogs(
    bot: SimulationBotWithContract,
    cachedLogs: CachedEventLogRecord[],
  ) {
    const histories = this.buildHistoriesFromCachedLogs(bot, cachedLogs);
    const leaderPositions =
      this.eventLogsService.convertToPerpTradePositionsWithSummary(
        bot.leaderPlatform,
        histories,
        { stoppedAt: bot.stoppedAt || undefined },
      );

    const simulatedPositions = simulateFollowerPositions(
      leaderPositions.positions,
      bot,
    );
    const executableHistories = simulatedPositions.flatMap((position) =>
      position.histories.map(({ leader }) => leader),
    );
    const positionsWithSummary =
      this.eventLogsService.convertToPerpTradePositionsWithSummary(
        bot.leaderPlatform,
        executableHistories,
        { stoppedAt: bot.stoppedAt || undefined },
      );

    let totalFollowerPnl = 0;
    const simulationPositions = simulatedPositions.map(
      ({ sizing: _sizing, ...position }) => {
        totalFollowerPnl += position.followerPnl;
        return position;
      },
    );

    const summary = {
      completed: this.isBotCacheComplete(bot, executableHistories),
      openedPositions: positionsWithSummary.openedPositions,
      totalPositions: positionsWithSummary.totalPositions,
      totalLeaderPnl: positionsWithSummary.totalPnl,
      totalFollowerPnl,
      maxDuration: positionsWithSummary.maxDuration,
      avgDuration: positionsWithSummary.avgDuration,
      avgPnl: positionsWithSummary.avgPnl,
      avgPositivePnl: positionsWithSummary.avgPositivePnl,
      avgNegativePnl: positionsWithSummary.avgNegativePnl,
      avgSize: positionsWithSummary.avgSize,
      avgCollateral: positionsWithSummary.avgCollateral,
      avgPnlPercentageBySize: positionsWithSummary.avgPnlPercentageBySize,
      avgPnlPercentageByCollateral:
        positionsWithSummary.avgPnlPercentageByCollateral,
      avgLeverage: positionsWithSummary.avgLeverage,
      positions: simulationPositions,
      followerPositionPnls: simulationPositions.map(
        (position) => position.followerPnl,
      ),
      realizedEquityCurve: buildRealizedEquityCurve(simulationPositions),
    };

    return summary;
  }

  async rebuildBotCache(
    simulationBotId: number,
    options: { fetchSourceEventLogs?: boolean } = {},
  ) {
    const bot = await this.prisma.simulationBot.findUniqueOrThrow({
      where: { id: simulationBotId },
      include: {
        cache: true,
      },
    });
    const leaderContracts = await this.prisma.contract.findMany({
      where: { platform: bot.leaderPlatform },
    });
    const botWithContracts = {
      ...bot,
      leaderContracts,
    };

    const cache = await this.ensureSimulationBotCache(bot.id);
    const existingEventLogCount =
      await this.prisma.simulationBotCachedEventLog.count({
        where: { simulationBotCacheId: cache.id },
      });
    const canCertifyFullLayer1Snapshot =
      cache.eventSnapshotVersion >= 2 || existingEventLogCount === 0;

    await this.prisma.simulationBotCache.update({
      where: { id: cache.id },
      data: {
        rebuilding: true,
        rebuildRequested: false,
        lastError: null,
      },
    });

    try {
      if (options.fetchSourceEventLogs !== false) {
        await this.appendNewEventLogsForBot(cache.id, botWithContracts);
      }

      const cachedLogs = await this.prisma.simulationBotCachedEventLog.findMany(
        {
          where: { simulationBotCacheId: cache.id },
          orderBy: getEventLogOrderBy(),
        },
      );

      const summary = this.buildBotSummaryFromCachedLogs(
        botWithContracts,
        cachedLogs,
      );

      return await this.prisma.simulationBotCache.update({
        where: { id: cache.id },
        data: {
          completed: summary.completed,
          eventSnapshotVersion: canCertifyFullLayer1Snapshot
            ? 2
            : cache.eventSnapshotVersion,
          openedPositions: summary.openedPositions,
          totalPositions: summary.totalPositions,
          totalLeaderPnl: summary.totalLeaderPnl,
          totalFollowerPnl: summary.totalFollowerPnl,
          maxDuration: summary.maxDuration,
          avgDuration: summary.avgDuration,
          avgPnl: summary.avgPnl,
          avgPositivePnl: summary.avgPositivePnl,
          avgNegativePnl: summary.avgNegativePnl,
          avgSize: summary.avgSize,
          avgCollateral: summary.avgCollateral,
          avgPnlPercentageBySize: summary.avgPnlPercentageBySize,
          avgPnlPercentageByCollateral: summary.avgPnlPercentageByCollateral,
          avgLeverage: summary.avgLeverage,
          rebuilding: false,
          lastFetchedAt: cachedLogs.at(-1)?.date ?? cache.lastFetchedAt,
          positionsJson: JSON.stringify(summary.positions),
          followerPositionPnlsJson: JSON.stringify(
            summary.followerPositionPnls,
          ),
          realizedEquityCurveJson: JSON.stringify(summary.realizedEquityCurve),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.prisma.simulationBotCache.update({
        where: { id: cache.id },
        data: {
          rebuilding: false,
          lastError: message,
        },
      });

      throw error;
    }
  }

  async rebuildPlanCache(simulationPlanId: number) {
    const botCaches = await this.prisma.simulationBotCache.findMany({
      where: {
        simulationBot: {
          simulationPlanId,
        },
      },
    });

    const completedBots = botCaches.filter((cache) => cache.completed).length;
    const incompleteBots = botCaches.length - completedBots;
    const openedPositions = botCaches.reduce(
      (sum, cache) => sum + cache.openedPositions,
      0,
    );
    const totalPositions = botCaches.reduce(
      (sum, cache) => sum + cache.totalPositions,
      0,
    );
    const totalLeaderPnl = botCaches.reduce(
      (sum, cache) => sum + cache.totalLeaderPnl,
      0,
    );
    const totalFollowerPnl = botCaches.reduce(
      (sum, cache) => sum + cache.totalFollowerPnl,
      0,
    );
    const realizedEquityCurve = mergeRealizedEquityCurves(
      botCaches.map((cache) => {
        try {
          const parsed = JSON.parse(cache.realizedEquityCurveJson);
          return Array.isArray(parsed) ? (parsed as RealizedEquityPoint[]) : [];
        } catch {
          return [];
        }
      }),
    );

    return this.prisma.simulationPlanCache.upsert({
      where: { simulationPlanId },
      update: {
        completed: incompleteBots === 0,
        rebuilding: false,
        completedBots,
        incompleteBots,
        openedPositions,
        totalPositions,
        totalLeaderPnl,
        totalFollowerPnl,
        realizedEquityCurveJson: JSON.stringify(realizedEquityCurve),
        lastBuiltAt: new Date(),
        lastError: null,
      },
      create: {
        simulationPlanId,
        completed: incompleteBots === 0,
        completedBots,
        incompleteBots,
        openedPositions,
        totalPositions,
        totalLeaderPnl,
        totalFollowerPnl,
        realizedEquityCurveJson: JSON.stringify(realizedEquityCurve),
        lastBuiltAt: new Date(),
      },
    });
  }

  async refreshIncompleteBotsForPlan(
    simulationPlanId: number,
    options: { fetchSourceEventLogs?: boolean } = {},
  ) {
    const bots = await this.prisma.simulationBot.findMany({
      where: { simulationPlanId },
      include: { cache: true },
    });

    for (const bot of bots) {
      if (bot.cache?.rebuilding) {
        continue;
      }

      if (!bot.cache || !bot.cache.completed || bot.cache.rebuildRequested) {
        await this.rebuildBotCache(bot.id, options);
        continue;
      }

      continue;
    }

    return this.rebuildPlanCache(simulationPlanId);
  }

  async backfillSimulationCaches(simulationId: number) {
    const plans = await this.prisma.simulationPlan.findMany({
      where: { simulationId },
      select: {
        id: true,
        simulationBots: {
          select: {
            id: true,
          },
        },
      },
    });

    for (const plan of plans) {
      await this.ensureSimulationPlanCache(plan.id);

      for (const bot of plan.simulationBots) {
        await this.ensureSimulationBotCache(bot.id);
        await this.rebuildBotCache(bot.id);
      }

      await this.rebuildPlanCache(plan.id);
    }
  }

  async comparePlanCacheWithStoredSummary(simulationPlanId: number) {
    const plan = await this.prisma.simulationPlan.findUnique({
      where: { id: simulationPlanId },
      include: {
        cache: true,
      },
    });

    if (!plan) {
      throw new Error('SimulationPlan not found');
    }

    if (!plan.cache) {
      return {
        planId: simulationPlanId,
        differences: ['missing-cache'],
      };
    }

    const differences: string[] = [];

    if (plan.cache.totalPositions !== plan.totalPositions) {
      differences.push(
        `totalPositions:${plan.cache.totalPositions}:${plan.totalPositions}`,
      );
    }

    if (plan.cache.totalLeaderPnl !== plan.totalLeaderPnl) {
      differences.push(
        `totalLeaderPnl:${plan.cache.totalLeaderPnl}:${plan.totalLeaderPnl}`,
      );
    }

    if (plan.cache.totalFollowerPnl !== plan.totalFollowerPnl) {
      differences.push(
        `totalFollowerPnl:${plan.cache.totalFollowerPnl}:${plan.totalFollowerPnl}`,
      );
    }

    return {
      planId: simulationPlanId,
      differences,
    };
  }
}

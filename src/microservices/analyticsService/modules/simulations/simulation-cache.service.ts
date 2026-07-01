import { Injectable } from '@nestjs/common';
import {
  BotMode,
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

type SimulationBotWithContract = SimulationBot & {
  leaderContracts: Pick<Contract, 'id' | 'platform' | 'version' | 'chainId'>[];
  cache?: SimulationBotCache | null;
};

type CachedEventLogRecord = Pick<
  PerpTradingEventLog,
  | 'id'
  | 'address'
  | 'contractId'
  | 'platform'
  | 'jsonLog'
  | 'usdPnl'
  | 'block'
  | 'logIndex'
  | 'date'
> & {
  sourceEventLogId?: number;
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
    bot: Pick<SimulationBot, 'leaderAddress' | 'leaderPlatform' | 'startedAt'>,
  ) {
    const existingLast =
      await this.prisma.simulationBotCachedEventLog.findFirst({
        where: { simulationBotCacheId: cacheId },
        orderBy: [{ date: 'desc' }, { block: 'desc' }, { id: 'desc' }],
      });

    const newLogs = await this.prisma.perpTradingEventLog.findMany({
      where: {
        address: bot.leaderAddress.toLowerCase(),
        platform: bot.leaderPlatform,
        ...(existingLast
          ? { date: { gt: existingLast.date } }
          : { date: { gte: bot.startedAt } }),
      },
      orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
    });

    if (newLogs.length === 0) {
      return [];
    }

    await this.prisma.simulationBotCachedEventLog.createMany({
      data: newLogs.map((log) => ({
        simulationBotCacheId: cacheId,
        sourceEventLogId: log.id,
        contractId: log.contractId,
        address: log.address,
        platform: log.platform,
        block: log.block,
        logIndex: log.logIndex,
        date: log.date,
        jsonLog: log.jsonLog,
        usdPnl: log.usdPnl,
      })),
      skipDuplicates: true,
    });

    return newLogs;
  }

  isBotCacheComplete(
    bot: Pick<SimulationBot, 'startedAt' | 'stoppedAt'>,
    histories: PerpTradeHistory[],
  ) {
    const openedKeys = new Set<string>();
    const closedKeys = new Set<string>();

    for (const history of histories) {
      const isDuringLifetime =
        history.date >= bot.startedAt &&
        (!bot.stoppedAt || history.date <= bot.stoppedAt);

      if (
        isDuringLifetime &&
        history.operation === PerpTradeHistoryOperation.OPEN
      ) {
        openedKeys.add(`${history.contractId}:${history.positionKey}`);
      }

      if (history.operation === PerpTradeHistoryOperation.CLOSE) {
        closedKeys.add(`${history.contractId}:${history.positionKey}`);
      }
    }

    for (const positionKey of openedKeys) {
      if (!closedKeys.has(positionKey)) {
        return false;
      }
    }

    return true;
  }

  buildHistoriesFromCachedLogs(
    bot: SimulationBotWithContract,
    cachedLogs: CachedEventLogRecord[],
  ) {
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
        );

        return history
          ? {
              ...history,
              id: record.sourceEventLogId ?? record.id,
              date: record.date,
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
    const positionsWithSummary =
      this.eventLogsService.convertToPerpTradePositionsWithSummary(
        bot.leaderPlatform,
        histories,
        {
          stoppedAt: bot.stoppedAt || undefined,
          maxLeverage: bot.maxLeverage,
        },
      );

    const signer = bot.mode === BotMode.Reversed ? -1 : 1;
    let totalFollowerPnl = 0;
    const simulationPositions = positionsWithSummary.positions.map(
      ({ histories }) => {
        let leaderPnl = 0;
        let followerPnl = 0;

        const simulationHistories = histories.map((history) => {
          const followerUsdFee =
            history.usdFee !== 0
              ? Math.min(-0.5, history.usdFee * bot.ratio)
              : 0;
          const followerUsdBasePnl = history.usdBasePnl * signer * bot.ratio;
          const followerUsdPnl = Math.max(
            -history.collateralDeltaUsd * bot.ratio,
            followerUsdBasePnl + followerUsdFee,
          );

          const follower = {
            ...history,
            id: -history.id,
            usdPnl: followerUsdPnl,
            usdBasePnl: followerUsdBasePnl,
            usdFee: followerUsdFee,
            sizeInUsd: history.sizeInUsd * bot.ratio,
            collateralInUsd: history.collateralInUsd * bot.ratio,
            collateralDeltaUsd: history.collateralDeltaUsd * bot.ratio,
            sizeDeltaUsd: history.sizeDeltaUsd * bot.ratio,
            isLong:
              bot.mode === BotMode.Reversed ? !history.isLong : history.isLong,
          };

          leaderPnl += history.usdPnl;
          followerPnl += follower.usdPnl;

          return {
            leader: history,
            follower,
          };
        });

        totalFollowerPnl += followerPnl;

        return {
          histories: simulationHistories,
          leaderPnl,
          followerPnl,
        };
      },
    );

    return {
      completed: this.isBotCacheComplete(bot, histories),
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
    };
  }

  async rebuildBotCache(simulationBotId: number) {
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

    await this.prisma.simulationBotCache.update({
      where: { id: cache.id },
      data: {
        rebuilding: true,
        rebuildRequested: false,
        lastError: null,
      },
    });

    try {
      await this.appendNewEventLogsForBot(cache.id, botWithContracts);

      const cachedLogs = await this.prisma.simulationBotCachedEventLog.findMany(
        {
          where: { simulationBotCacheId: cache.id },
          orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
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
        lastBuiltAt: new Date(),
      },
    });
  }

  async refreshIncompleteBotsForPlan(simulationPlanId: number) {
    const bots = await this.prisma.simulationBot.findMany({
      where: { simulationPlanId },
      include: { cache: true },
    });

    for (const bot of bots) {
      if (!bot.cache || !bot.cache.completed || bot.cache.rebuildRequested) {
        if (bot.cache?.rebuilding) {
          continue;
        }

        await this.rebuildBotCache(bot.id);
      }
    }

    await this.rebuildPlanCache(simulationPlanId);
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

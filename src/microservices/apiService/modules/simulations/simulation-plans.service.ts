import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import dayjs from 'dayjs';

import {
  SimulationBotDetails,
  SimulationPlan,
  SimulationPlanDetails,
  SimulationTradeHistory,
} from './entities/simulations.entity';
import {
  mapSimulationBotDetailsWithCache,
  mapSimulationPlanWithCache,
} from './simulation-cache.mapper';

import { PrismaService } from 'src/global/prisma.service';
import { EventLogsService } from '../trade-histories/event-logs.service';
import { getWeb3Info } from 'src/web3/utils';
import {
  getEventLogOrderBy,
  getEventLogStableId,
} from '../trade-histories/event-log-identity.utils';
import { BotMode } from 'generated/prisma/enums';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
} from '../trade-histories/entities/event-logs.entity';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

export type SimulationPlanDetailsOptions = {
  persistSummary?: boolean;
};

@Injectable()
export class SimulationPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogsService: EventLogsService,
    @Optional()
    @Inject(SERVICE_NAMES.REDIS_SERVICE)
    private readonly redisClient?: ClientProxy,
  ) {}

  private async emitSimulationPlanUpdated(simulationPlan: SimulationPlan) {
    if (!this.redisClient) {
      return;
    }

    await this.redisClient.emit(
      PATTERNS.Simulations.SimulationPlanUpdated,
      simulationPlan,
    );
  }

  private async ensureSimulationPlanCache(simulationPlanId: number) {
    return this.prisma.simulationPlanCache.upsert({
      where: { simulationPlanId },
      update: {},
      create: { simulationPlanId },
    });
  }

  private async ensureSimulationBotCache(simulationBotId: number) {
    return this.prisma.simulationBotCache.upsert({
      where: { simulationBotId },
      update: {},
      create: { simulationBotId },
    });
  }

  async calculateSimulationPlanDetails(
    id: number,
    options: SimulationPlanDetailsOptions = {},
  ): Promise<SimulationPlanDetails> {
    const { persistSummary = true } = options;
    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: { id },
      include: {
        simulationBots: true,
      },
    });

    if (!simulationPlan) {
      throw new Error('SimulationPlan not found');
    }

    const leaderPlatforms = [
      ...new Set(
        simulationPlan.simulationBots.map((bot) => bot.leaderPlatform),
      ),
    ];
    const contracts = await this.prisma.contract.findMany({
      where: {
        platform: {
          in: leaderPlatforms,
        },
      },
    });
    const contractById = new Map(
      contracts.map((contract) => [contract.id, contract]),
    );
    const simulationBotDetails: SimulationBotDetails[] = [];

    let totalPositions = 0;
    let openedPositions = 0;
    let totalLeaderPnl = 0;
    let totalFollowerPnl = 0;

    for (const bot of simulationPlan.simulationBots) {
      const stoppedAt = bot.stoppedAt;
      const records = await this.prisma.perpTradingEventLog.findMany({
        where: {
          address: bot.leaderAddress.toLowerCase(),
          platform: bot.leaderPlatform,
          date: {
            gte: bot.startedAt,
            ...(stoppedAt
              ? { lt: dayjs(stoppedAt).add(60, 'day').toDate() }
              : {}),
          },
        },
        orderBy: getEventLogOrderBy(),
      });

      const positionsWithSummary =
        this.eventLogsService.convertToPerpTradePositionsWithSummary(
          bot.leaderPlatform,
          records
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
                JSON.parse(record.jsonLog) as any,
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
            .filter((item): item is PerpTradeHistory => !!item),
          {
            stoppedAt: stoppedAt || undefined,
            minCollateral: bot.minCollateral,
            maxCollateral: bot.maxCollateral,
            minLeverage: bot.minLeverage,
            maxLeverage: bot.maxLeverage,
          },
        );

      const signer = bot.mode === BotMode.Reversed ? -1 : 1;

      const simulationPositions = positionsWithSummary.positions.map(
        ({ histories }) => {
          let leaderPnl = 0;
          let followerPnl = 0;

          const simulationHistories: SimulationTradeHistory[] = [];

          for (const history of histories) {
            if (history.operation === PerpTradeHistoryOperation.PNL_WITHDRAW) {
              continue;
            }

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
                bot.mode === BotMode.Reversed
                  ? !history.isLong
                  : history.isLong,
            };

            leaderPnl += history.usdPnl;
            followerPnl += follower.usdPnl;

            simulationHistories.push({
              leader: history,
              follower,
            });
          }

          return {
            histories: simulationHistories,
            leaderPnl,
            followerPnl,
          };
        },
      );

      totalPositions += positionsWithSummary.totalPositions;
      openedPositions += positionsWithSummary.openedPositions;
      totalLeaderPnl += positionsWithSummary.totalPnl;
      totalFollowerPnl += simulationPositions
        .map((position) => position.followerPnl)
        .reduce((acc, item) => acc + item, 0);

      const calculatedBot = {
        ...bot,
        openedPositions: positionsWithSummary.openedPositions,
        totalPositions: positionsWithSummary.totalPositions,
        totalPnl: positionsWithSummary.totalPnl,
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
      };

      const simulationBot = persistSummary
        ? await this.prisma.simulationBot.update({
            where: {
              id: bot.id,
            },
            data: {
              openedPositions: calculatedBot.openedPositions,
              totalPositions: calculatedBot.totalPositions,
              totalPnl: calculatedBot.totalPnl,
              maxDuration: calculatedBot.maxDuration,
              avgDuration: calculatedBot.avgDuration,
              avgPnl: calculatedBot.avgPnl,
              avgPositivePnl: calculatedBot.avgPositivePnl,
              avgNegativePnl: calculatedBot.avgNegativePnl,
              avgSize: calculatedBot.avgSize,
              avgCollateral: calculatedBot.avgCollateral,
              avgPnlPercentageBySize: calculatedBot.avgPnlPercentageBySize,
              avgPnlPercentageByCollateral:
                calculatedBot.avgPnlPercentageByCollateral,
              avgLeverage: calculatedBot.avgLeverage,
            },
          })
        : calculatedBot;

      simulationBotDetails.push({
        ...simulationBot,
        positions: simulationPositions,
      });
    }

    const calculatedSimulationPlan = {
      ...simulationPlan,
      openedPositions,
      totalPositions,
      totalLeaderPnl,
      totalFollowerPnl,
    };

    const updatedSimulationPlan = persistSummary
      ? await this.prisma.simulationPlan.update({
          where: {
            id,
          },
          data: {
            openedPositions,
            totalPositions,
            totalLeaderPnl,
            totalFollowerPnl,
          },
        })
      : calculatedSimulationPlan;

    return {
      ...updatedSimulationPlan,
      simulationBots: simulationBotDetails,
    };
  }

  async getSimulationPlanById(id: number): Promise<SimulationPlanDetails> {
    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: { id },
      include: {
        cache: true,
        simulationBots: {
          include: {
            cache: true,
          },
        },
      },
    });

    if (!simulationPlan) {
      throw new Error('SimulationPlan not found');
    }

    if (!simulationPlan.cache) {
      return await this.calculateSimulationPlanDetails(id);
    }

    if (simulationPlan.simulationBots.some((bot) => !bot.cache)) {
      return await this.calculateSimulationPlanDetails(id);
    }

    return {
      ...mapSimulationPlanWithCache(simulationPlan),
      simulationBots: simulationPlan.simulationBots.map((bot) => ({
        ...mapSimulationBotDetailsWithCache(bot),
        cacheState: bot.cache
          ? {
              completed: bot.cache.completed,
              rebuilding: bot.cache.rebuilding,
              rebuildRequested: bot.cache.rebuildRequested,
              lastError: bot.cache.lastError,
              lastFetchedAt: bot.cache.lastFetchedAt,
            }
          : null,
      })),
    };
  }

  async getSimulationPlanDetailsBySimulation(
    simulationId: number,
  ): Promise<SimulationPlanDetails[]> {
    const plans = await this.prisma.simulationPlan.findMany({
      where: { simulationId },
      orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
      include: {
        cache: true,
        simulationBots: {
          include: {
            cache: true,
          },
        },
      },
    });

    return await Promise.all(
      plans.map(async (plan) => {
        if (!plan.cache) {
          return await this.calculateSimulationPlanDetails(plan.id);
        }

        if (plan.simulationBots.some((bot) => !bot.cache)) {
          return await this.calculateSimulationPlanDetails(plan.id);
        }

        return {
          ...mapSimulationPlanWithCache(plan),
          simulationBots: plan.simulationBots.map((bot) => ({
            ...mapSimulationBotDetailsWithCache(bot),
            cacheState: bot.cache
              ? {
                  completed: bot.cache.completed,
                  rebuilding: bot.cache.rebuilding,
                  rebuildRequested: bot.cache.rebuildRequested,
                  lastError: bot.cache.lastError,
                  lastFetchedAt: bot.cache.lastFetchedAt,
                }
              : null,
          })),
        };
      }),
    );
  }
}

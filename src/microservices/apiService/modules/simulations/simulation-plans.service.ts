import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';

import {
  SimulationBotDetails,
  SimulationPlanDetails,
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
import { PerpTradeHistory } from '../trade-histories/entities/event-logs.entity';
import { simulateFollowerPositions } from './simulation-position-execution';
import { mapSimulationBotConfiguration } from './simulation-bot-config.mapper';

export type SimulationPlanDetailsOptions = {
  persistSummary?: boolean;
  eventSource?: 'live' | 'sourceSnapshot';
};

@Injectable()
export class SimulationPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogsService: EventLogsService,
  ) {}

  async calculateSimulationPlanDetails(
    id: number,
    options: SimulationPlanDetailsOptions = {},
  ): Promise<SimulationPlanDetails> {
    const { persistSummary = true, eventSource = 'live' } = options;
    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: { id },
      include: {
        simulationBots: {
          include: {
            cache: {
              include: {
                eventLogs: { orderBy: getEventLogOrderBy() },
              },
            },
          },
        },
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
      const sourceCache = bot.cache;
      if (
        eventSource === 'sourceSnapshot' &&
        (!sourceCache ||
          sourceCache.eventSnapshotVersion < 2 ||
          !sourceCache.snapshotCapturedAt)
      ) {
        throw new Error(
          `Source snapshot is unavailable for simulation bot ${bot.id}`,
        );
      }
      const records =
        eventSource === 'sourceSnapshot'
          ? sourceCache!.eventLogs
          : await this.prisma.perpTradingEventLog.findMany({
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

      const leaderPositions =
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
            .filter((item): item is PerpTradeHistory => !!item),
          { stoppedAt: stoppedAt || undefined },
        );
      const simulatedFollowerPositions = simulateFollowerPositions(
        leaderPositions.positions,
        bot,
      );
      const executableHistories = simulatedFollowerPositions.flatMap(
        (position) => position.histories.map(({ leader }) => leader),
      );
      const positionsWithSummary =
        this.eventLogsService.convertToPerpTradePositionsWithSummary(
          bot.leaderPlatform,
          executableHistories,
          { stoppedAt: stoppedAt || undefined },
        );
      const simulationPositions = simulatedFollowerPositions.map(
        ({ sizing: _sizing, ...position }) => position,
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
        ...mapSimulationBotConfiguration(simulationBot),
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
        ...mapSimulationBotConfiguration(mapSimulationBotDetailsWithCache(bot)),
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
            ...mapSimulationBotConfiguration(
              mapSimulationBotDetailsWithCache(bot),
            ),
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

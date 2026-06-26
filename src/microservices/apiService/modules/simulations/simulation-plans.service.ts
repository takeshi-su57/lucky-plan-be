import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';

import {
  CreateSimulationBotInput,
  CreateSimulationPlanInput,
  UpdateSimulationBotInput,
} from './dto/simulations.input';
import {
  SimulationBot,
  SimulationBotDetails,
  SimulationPlan,
  SimulationPlanConnection,
  SimulationPlanDetails,
  SimulationTradeHistory,
} from './entities/simulations.entity';
import {
  mapSimulationBotWithCache,
  mapSimulationPlanWithCache,
} from './simulation-cache.mapper';

import { PrismaService } from 'src/global/prisma.service';
import { EventLogsService } from '../trade-histories/event-logs.service';
import { getWeb3Info } from 'src/web3/utils';
import { BotMode, SimulationStatus } from 'generated/prisma/enums';
import { PerpTradeHistory } from '../trade-histories/entities/event-logs.entity';
import { sum } from './simulation-automation.utils';
import { SimulationCacheService } from './simulation-cache.service';

export type SimulationPlanDetailsOptions = {
  persistSummary?: boolean;
};

@Injectable()
export class SimulationPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogsService: EventLogsService,
    private readonly simulationCacheService: SimulationCacheService,
  ) {}

  async createSimulationPlan(
    createSimulationPlanInput: CreateSimulationPlanInput,
  ): Promise<SimulationPlan> {
    const simulationPlan = await this.prisma.simulationPlan.create({
      data: {
        ...createSimulationPlanInput,
        startAt: new Date(
          dayjs(createSimulationPlanInput.startAt).format('YYYY-MM-DD'),
        ),
        endAt: new Date(
          dayjs(createSimulationPlanInput.endAt).format('YYYY-MM-DD'),
        ),
        cursor: createSimulationPlanInput.startAt,
      },
      include: {
        simulationBots: {
          include: {
            leaderContract: true,
          },
        },
      },
    });

    await this.simulationCacheService.ensureSimulationPlanCache(
      simulationPlan.id,
    );

    return simulationPlan;
  }

  async deleteSimulationPlan(id: number): Promise<number> {
    await this.prisma.$transaction(async (tx) => {
      const simulationPlan = await tx.simulationPlan.findUnique({
        where: { id },
        include: {
          simulation: true,
        },
      });

      if (!simulationPlan) {
        throw new Error('SimulationPlan not found');
      }

      const simulationId = simulationPlan.simulationId;

      if (simulationPlan.simulation?.status === SimulationStatus.Running) {
        throw new Error('Cannot delete a plan from a running simulation');
      }

      await tx.simulationLeaderSelection.deleteMany({
        where: { simulationPlanId: id },
      });

      await tx.simulationBot.deleteMany({
        where: { simulationPlanId: id },
      });

      await tx.simulationPlan.delete({
        where: { id },
      });

      if (simulationId) {
        const remainingPlans = await tx.simulationPlan.findMany({
          where: { simulationId },
          select: {
            cursor: true,
            endAt: true,
            totalLeaderPnl: true,
            totalFollowerPnl: true,
            totalPositions: true,
          },
        });

        const completedPlans = remainingPlans.filter(
          (plan) => plan.cursor.getTime() >= plan.endAt.getTime(),
        ).length;
        const totalLeaderPnl = sum(
          remainingPlans.map((plan) => plan.totalLeaderPnl),
        );
        const totalFollowerPnl = sum(
          remainingPlans.map((plan) => plan.totalFollowerPnl),
        );

        await tx.simulation.update({
          where: { id: simulationId },
          data: {
            totalSimulationPlans: remainingPlans.length,
            completedPlans,
            totalLeaderPnl,
            totalFollowerPnl,
            totalNetPnlUsd: totalFollowerPnl,
            tradeCount: sum(remainingPlans.map((plan) => plan.totalPositions)),
            progressPercent:
              remainingPlans.length > 0
                ? (completedPlans / remainingPlans.length) * 100
                : 0,
          },
        });
      }
    });

    return id;
  }

  async batchCreateSimulationBots(
    inputs: CreateSimulationBotInput[],
  ): Promise<SimulationBot[]> {
    if (inputs.length === 0) {
      return [];
    }

    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: {
        id: inputs[0].simulationPlanId,
      },
    });

    if (!simulationPlan) {
      throw new Error('Invalid plan id');
    }

    const simulationBots: SimulationBot[] = [];

    for (let i = 0; i < inputs.length; i++) {
      const input = inputs[i];

      const bot = await this.prisma.simulationBot.create({
        data: {
          ...input,
          startedAt: simulationPlan.cursor,
        },
        include: {
          leaderContract: true,
        },
      });

      await this.simulationCacheService.ensureSimulationBotCache(bot.id);
      simulationBots.push(bot);
    }

    return simulationBots;
  }

  async updateSimulationBot(
    input: UpdateSimulationBotInput,
  ): Promise<SimulationBot> {
    return await this.prisma.simulationBot.update({
      where: {
        id: input.id,
      },
      data: {
        ratio: input.ratio ?? undefined,
        maxLeverage: input.maxLeverage ?? undefined,
        mode: input.mode ?? undefined,
      },
      include: {
        leaderContract: true,
      },
    });
  }

  async playSimulationPlan(id: number): Promise<SimulationPlan> {
    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: {
        id,
      },
    });

    if (!simulationPlan) {
      throw new Error('Invalid plan id');
    }

    const nextCursor = Math.min(
      simulationPlan.endAt.getTime(),
      dayjs(simulationPlan.cursor).add(1, 'day').toDate().getTime(),
    );

    return await this.prisma.simulationPlan.update({
      where: {
        id,
      },
      data: {
        cursor: new Date(nextCursor),
      },
      include: {
        simulationBots: {
          include: {
            leaderContract: true,
          },
        },
      },
    });
  }

  async stopSimulationBot(id: number): Promise<SimulationBot> {
    const simulationBot = await this.prisma.simulationBot.findUnique({
      where: {
        id,
      },
      include: {
        simulationPlan: true,
      },
    });

    if (!simulationBot) {
      throw new Error('Invalid bot id');
    }

    return await this.prisma.simulationBot.update({
      where: {
        id,
      },
      data: {
        stoppedAt: simulationBot.simulationPlan.cursor,
      },
      include: {
        leaderContract: true,
      },
    });
  }

  async getSimulationPlans(
    first: number,
    after: number | null,
  ): Promise<SimulationPlanConnection> {
    const records = await this.prisma.simulationPlan.findMany({
      where: {
        simulationId: null,
      },
      skip: after ? 1 : undefined,
      take: first,
      cursor: after
        ? {
            id: after,
          }
        : undefined,
      orderBy: [
        {
          id: 'desc',
        },
      ],
      include: {
        simulationBots: {
          include: {
            leaderContract: true,
          },
        },
      },
    });

    const edges = records.map((record) => ({
      cursor: record.id,
      node: record,
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage: edges.length === first,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
    };
  }

  async calculateSimulationPlanDetails(
    id: number,
    options: SimulationPlanDetailsOptions = {},
  ): Promise<SimulationPlanDetails> {
    const { persistSummary = true } = options;
    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: { id },
      include: {
        simulationBots: {
          include: {
            leaderContract: true,
          },
        },
      },
    });

    if (!simulationPlan) {
      throw new Error('SimulationPlan not found');
    }

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
          contractId: bot.leaderContractId,
          date: {
            gte: bot.startedAt,
            ...(stoppedAt
              ? { lt: dayjs(stoppedAt).add(60, 'day').toDate() }
              : {}),
          },
        },
        orderBy: [
          {
            date: 'asc',
          },
          {
            block: 'asc',
          },
          {
            id: 'asc',
          },
        ],
      });

      const positionsWithSummary =
        this.eventLogsService.convertToPerpTradePositionsWithSummary(
          bot.leaderContract.platform,
          records
            .map((record) => {
              const history = getWeb3Info(
                bot.leaderContract.platform,
                bot.leaderContract.version,
              ).eventToPerpTradeHistory(
                bot.leaderContract.chainId,
                JSON.parse(record.jsonLog) as any,
              );

              return history
                ? {
                    ...history,
                    id: record.id,
                    date: record.date,
                    contractId: record.contractId,
                    platform: record.platform,
                  }
                : null;
            })
            .filter((item): item is PerpTradeHistory => !!item),
          {
            stoppedAt: stoppedAt || undefined,
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
            include: {
              leaderContract: true,
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
            leaderContract: true,
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

    void this.simulationCacheService.refreshIncompleteBotsForPlan(id);

    return {
      ...mapSimulationPlanWithCache(simulationPlan),
      simulationBots: simulationPlan.simulationBots.map((bot) => ({
        ...mapSimulationBotWithCache(bot),
        cacheState: bot.cache
          ? {
              completed: bot.cache.completed,
              rebuilding: bot.cache.rebuilding,
              rebuildRequested: bot.cache.rebuildRequested,
              lastError: bot.cache.lastError,
              lastFetchedAt: bot.cache.lastFetchedAt,
            }
          : null,
        positions: [],
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
            leaderContract: true,
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

        void this.simulationCacheService.refreshIncompleteBotsForPlan(plan.id);

        return {
          ...mapSimulationPlanWithCache(plan),
          simulationBots: plan.simulationBots.map((bot) => ({
            ...mapSimulationBotWithCache(bot),
            cacheState: bot.cache
              ? {
                  completed: bot.cache.completed,
                  rebuilding: bot.cache.rebuilding,
                  rebuildRequested: bot.cache.rebuildRequested,
                  lastError: bot.cache.lastError,
                  lastFetchedAt: bot.cache.lastFetchedAt,
                }
              : null,
            positions: [],
          })),
        };
      }),
    );
  }
}

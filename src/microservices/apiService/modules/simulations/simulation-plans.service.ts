import { Inject, Injectable, Optional } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
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
import { BotMode, SimulationStatus } from 'generated/prisma/enums';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
} from '../trade-histories/entities/event-logs.entity';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

function sum(values: number[]) {
  return values.reduce((acc, value) => acc + value, 0);
}

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

  private async deleteSimulationBotInTransaction(tx: any, id: number) {
    const simulationBot = await tx.simulationBot.findUnique({
      where: { id },
      include: {
        simulationPlan: {
          include: {
            simulation: true,
          },
        },
      },
    });

    if (!simulationBot) {
      throw new Error('SimulationBot not found');
    }

    if (
      simulationBot.simulationPlan.simulation?.status ===
      SimulationStatus.Running
    ) {
      throw new Error('Cannot delete a bot from a running simulation');
    }

    await tx.simulationBot.delete({
      where: { id },
    });
  }

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
        simulationBots: true,
      },
    });

    await this.ensureSimulationPlanCache(simulationPlan.id);

    await this.emitSimulationPlanUpdated(simulationPlan);

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

  async deleteSimulationBot(id: number): Promise<number> {
    await this.prisma.$transaction(async (tx) => {
      await this.deleteSimulationBotInTransaction(tx, id);
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
      });

      await this.ensureSimulationBotCache(bot.id);
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
        minCollateral: input.minCollateral ?? undefined,
        maxCollateral: input.maxCollateral ?? undefined,
        minLeverage: input.minLeverage ?? undefined,
        maxLeverage: input.maxLeverage ?? undefined,
        mode: input.mode ?? undefined,
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

    const updated = await this.prisma.simulationPlan.update({
      where: {
        id,
      },
      data: {
        cursor: new Date(nextCursor),
      },
      include: {
        simulationBots: true,
      },
    });

    await this.emitSimulationPlanUpdated(updated);

    return updated;
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
        simulationBots: true,
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

import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';

import {
  CreateSimulationPlanInput,
  CreateSimulationBotInput,
} from './dto/simulations.input';
import {
  SimulationBot,
  SimulationPlan,
  SimulationPlanDetails,
  SimulationPlanConnection,
  SimulationBotDetails,
} from './entities/simulations.entity';

import { PrismaService } from 'src/global/prisma.service';
import { EventLogsService } from '../trade-histories/event-logs.service';
import { getWeb3Info } from 'src/web3/utils';
import { BotMode } from 'generated/prisma/enums';

@Injectable()
export class SimulationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogsService: EventLogsService,
  ) {}

  async createSimulationPlan(
    createSimulationPlanInput: CreateSimulationPlanInput,
  ): Promise<SimulationPlan> {
    const simulationPlan = await this.prisma.simulationPlan.create({
      data: {
        ...createSimulationPlanInput,
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

    return simulationPlan;
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

      simulationBots.push(bot);
    }

    return simulationBots;
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

  async getSimulationPlans(
    first: number,
    after: number | null,
  ): Promise<SimulationPlanConnection> {
    const records = await this.prisma.simulationPlan.findMany({
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
        hasNextPage: edges.length > 0,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
    };
  }

  async getSimulationPlanById(id: number): Promise<SimulationPlanDetails> {
    const simulationPlan = await this.prisma.simulationPlan.findUnique({
      where: { id },
      include: {
        simulationBots: {
          include: {
            strategy: true,
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
      const records = await this.prisma.perpTradingEventLog.findMany({
        where: {
          address: bot.leaderAddress.toLowerCase(),
          contractId: bot.leaderContractId,
          date: {
            gte: bot.startedAt,
            lte: simulationPlan.cursor,
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
            .filter((item) => !!item),
          bot.stoppedAt,
        );

      const signer = bot.mode === BotMode.Reversed ? -1 : 1;

      totalPositions += positionsWithSummary.totalPositions;
      openedPositions += positionsWithSummary.openedPositions;
      totalLeaderPnl += positionsWithSummary.totalPnl;
      totalFollowerPnl += positionsWithSummary.totalPnl * signer * bot.ratio;

      const updatedSimuationBot = await this.prisma.simulationBot.update({
        where: {
          id: bot.id,
        },
        data: {
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
        },
        include: {
          leaderContract: true,
        },
      });

      simulationBotDetails.push({
        ...updatedSimuationBot,
        positions: positionsWithSummary.positions.map(({ histories }) => ({
          histories: histories.map((history) => ({
            leader: history,
            follower: {
              ...history,
              usdPnl: history.usdPnl * signer * bot.ratio,
              sizeInUsd: history.sizeInUsd * bot.ratio,
              collateralInUsd: history.collateralInUsd * bot.ratio,
              collateralDeltaUsd: history.collateralDeltaUsd * bot.ratio,
              sizeDeltaUsd: history.sizeDeltaUsd * bot.ratio,
              isLong:
                bot.mode === BotMode.Reversed
                  ? !history.isLong
                  : history.isLong,
            },
          })),
        })),
      });
    }

    const updatedSimulationPlan = await this.prisma.simulationPlan.update({
      where: {
        id,
      },
      data: {
        openedPositions,
        totalPositions,
        totalLeaderPnl,
        totalFollowerPnl,
      },
    });

    return {
      ...updatedSimulationPlan,
      simulationBots: simulationBotDetails,
    };
  }
}

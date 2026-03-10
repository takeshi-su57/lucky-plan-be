import { Injectable, Inject } from '@nestjs/common';
import {
  BotStatus,
  MissionStatus,
  Platform,
  PlanStatus,
} from 'generated/prisma/client';
import { ClientProxy } from '@nestjs/microservices';

import { CreatePlanInput, UpdatePlanInput } from './dto/plan.input';
import {
  PlanConnection,
  PlanForwardDetails,
  PlanSummaryConnection,
  ContractPnlSummary,
  Plan,
  BotGroupPaginatedResponse,
} from './entities/plan.entity';
import {
  convertTradeActionToHistory,
  TradeActionType,
  CLOSE_ACTION_TYPES,
} from './utils/convert-trade-action';
import { getCollaterals } from 'src/web3/platform/gns/v10/configs';

import { PrismaService } from 'src/global/prisma.service';
import { BotsService } from 'src/microservices/apiService/modules/bots/bots.service';
import { getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { ServiceStatus } from 'src/types';

@Injectable()
export class PlansService {
  status: ServiceStatus = ServiceStatus.READY;

  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prisma: PrismaService,
    private readonly botService: BotsService,
    private logger: LogsService,
  ) {}

  async create(
    userId: string,
    createPlanInput: CreatePlanInput,
  ): Promise<Plan> {
    const plan = await this.prisma.plan.create({
      data: {
        ...createPlanInput,
        userId,
        status: PlanStatus.Created,
      },
    });

    await this.redisClient.emit(PATTERNS.Plans.PlanCreated, plan);

    return plan;
  }

  private async checkAuthorization(userId: string, planId: number) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new Error('Plan not found');
    }

    if (plan.userId !== userId) {
      throw new Error('Unauthorized User');
    }
  }

  private async _delete(id: number): Promise<number> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
    });

    if (!plan) {
      throw new Error('Plan not found');
    }

    if (plan.status !== PlanStatus.Created) {
      throw new Error('Plan is in started status');
    }

    await this.prisma.plan.delete({
      where: { id },
    });

    return id;
  }

  async delete(userId: string, id: number): Promise<number> {
    await this.checkAuthorization(userId, id);

    return await this._delete(id);
  }

  private async _update(input: UpdatePlanInput): Promise<Plan> {
    const plan = await this.prisma.plan.update({
      where: { id: input.id },
      data: input,
      include: {},
    });

    await this.redisClient.emit(PATTERNS.Plans.PlanUpdated, plan);

    return plan;
  }

  async update(userId: string, input: UpdatePlanInput): Promise<Plan> {
    await this.checkAuthorization(userId, input.id);

    return await this._update(input);
  }

  async getPlansByStatus(
    userId: string,
    status: PlanStatus,
    first: number,
    after: number | null,
  ): Promise<PlanConnection> {
    const records = await this.prisma.plan.findMany({
      skip: after ? 1 : undefined,
      take: first,
      cursor: after
        ? {
            id: after,
          }
        : undefined,
      where: { status, userId },
      orderBy: [
        { startedAt: 'desc' },
        {
          id: 'asc',
        },
      ],
      include: {
        bots: {
          include: {
            follower: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
            missions: {
              include: {
                tasks: {
                  include: {
                    action: true,
                    followerActions: {
                      include: {
                        action: true,
                      },
                    },
                  },
                },
              },
            },
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

  async getPlanSummariesByStatus(
    userId: string,
    status: PlanStatus,
    first: number,
    after: number | null,
  ): Promise<PlanSummaryConnection> {
    const records = await this.prisma.plan.findMany({
      skip: after ? 1 : undefined,
      take: first,
      cursor: after
        ? {
            id: after,
          }
        : undefined,
      where: { status, userId },
      orderBy: [
        { startedAt: 'desc' },
        {
          id: 'asc',
        },
      ],
      include: {
        bots: {
          include: {
            leaderContract: true,
            followerContract: true,
            missions: {
              include: {
                tasks: {
                  include: {
                    action: true,
                    followerActions: {
                      include: {
                        action: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    const edges = records.map((record) => {
      const finished = record.status === PlanStatus.Finished;
      const contractMap = new Map<
        number,
        { chainId: number; side: 'leader' | 'follower' }
      >();

      for (const bot of record.bots) {
        if (!contractMap.has(bot.leaderContractId)) {
          contractMap.set(bot.leaderContractId, {
            chainId: bot.leaderContract.chainId,
            side: 'leader',
          });
        }
        if (!contractMap.has(bot.followerContractId)) {
          contractMap.set(bot.followerContractId, {
            chainId: bot.followerContract.chainId,
            side: 'follower',
          });
        }
      }

      const leaderPnl: ContractPnlSummary[] = [];
      const followerPnl: ContractPnlSummary[] = [];

      const leaderContractIds = [
        ...new Set(record.bots.map((b) => b.leaderContractId)),
      ];
      const followerContractIds = [
        ...new Set(record.bots.map((b) => b.followerContractId)),
      ];

      for (const contractId of leaderContractIds) {
        const info = contractMap.get(contractId);
        if (!info) continue;

        const collaterals = getCollaterals(info.chainId);
        const bots = record.bots.filter(
          (b) => b.leaderContractId === contractId,
        );

        const finishedMissionActions = bots.flatMap((bot) =>
          bot.missions
            .filter(
              (m) =>
                !!m.achievePositionKey && m.status === MissionStatus.Closed,
            )
            .map((m) => m.tasks.map((t) => t.action)),
        );

        const openedMissionActions = bots.flatMap((bot) =>
          bot.missions
            .filter(
              (m) =>
                !!m.achievePositionKey &&
                m.status !== MissionStatus.Ignored &&
                m.status !== MissionStatus.Closed,
            )
            .map((m) => m.tasks.map((t) => t.action)),
        );

        leaderPnl.push(
          this.computeContractPnlSummary(
            contractId,
            info.chainId,
            finishedMissionActions,
            openedMissionActions,
            finished,
            collaterals,
          ),
        );
      }

      for (const contractId of followerContractIds) {
        const info = contractMap.get(contractId);
        if (!info) continue;

        const collaterals = getCollaterals(info.chainId);
        const bots = record.bots.filter(
          (b) => b.followerContractId === contractId,
        );

        const finishedMissionActions = bots.flatMap((bot) =>
          bot.missions
            .filter(
              (m) =>
                m.status === MissionStatus.Closed && !!m.achievePositionKey,
            )
            .map((m) =>
              m.tasks
                .map((t) => {
                  if (t.followerActions.length === 0) return null;
                  const fa = t.followerActions[t.followerActions.length - 1];
                  return fa?.action ?? null;
                })
                .filter((a) => a !== null),
            ),
        );

        const openedMissionActions = bots.flatMap((bot) =>
          bot.missions
            .filter(
              (m) =>
                m.status !== MissionStatus.Closed &&
                m.status !== MissionStatus.Ignored &&
                !!m.achievePositionKey,
            )
            .map((m) =>
              m.tasks
                .map((t) => {
                  if (t.followerActions.length === 0) return null;
                  const fa = t.followerActions[t.followerActions.length - 1];
                  return fa?.action ?? null;
                })
                .filter((a) => a !== null),
            ),
        );

        followerPnl.push(
          this.computeContractPnlSummary(
            contractId,
            info.chainId,
            finishedMissionActions,
            openedMissionActions,
            finished,
            collaterals,
          ),
        );
      }

      return {
        cursor: record.id,
        node: {
          id: record.id,
          userId: record.userId,
          title: record.title,
          description: record.description,
          startedAt: record.startedAt,
          endedAt: record.endedAt,
          scheduledStart: record.scheduledStart,
          scheduledEnd: record.scheduledEnd,
          status: record.status,
          botCount: record.bots.length,
          leaderPnl,
          followerPnl,
        },
      };
    });

    return {
      edges,
      pageInfo: {
        hasNextPage: edges.length > 0,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
    };
  }

  private computeContractPnlSummary(
    contractId: number,
    chainId: number,
    finishedMissionActions: any[][],
    openedMissionActions: any[][],
    finished: boolean,
    collaterals: any[],
  ): ContractPnlSummary {
    let realizedPnl = 0;
    let realizedCount = 0;

    for (const missionActions of finishedMissionActions) {
      for (const action of missionActions) {
        const history = convertTradeActionToHistory(
          contractId,
          action,
          collaterals,
        );
        if (history) {
          realizedPnl += (history.pnl || 0) * (history.collateralPriceUsd || 0);
          realizedCount++;
        }
      }
    }

    const openPositions = finished
      ? []
      : openedMissionActions
          .map((missionActions) =>
            missionActions
              .map((action) =>
                convertTradeActionToHistory(contractId, action, collaterals),
              )
              .filter((h) => h !== null),
          )
          .filter(
            (missionHistories) =>
              !missionHistories.find((h) =>
                CLOSE_ACTION_TYPES.includes(h.action),
              ),
          )
          .map((missionHistories) => {
            let openPrice = 0;
            let long = false;
            let size = 0;
            let leverage = 0;
            let pairIndex = 0;

            for (const history of missionHistories) {
              if (history.action !== TradeActionType.TradeLeverageUpdate) {
                openPrice = history.price;
                long = !!history.long;
              }
              size = history.size * history.collateralPriceUsd;
              leverage = history.leverage;
              pairIndex = history.pairIndex;
            }

            return { openPrice, long, size, leverage, pairIndex };
          });

    return {
      contractId,
      chainId,
      realizedPnl,
      realizedCount,
      openPositions,
    };
  }

  async getPlanById(
    userId: string,
    id: number,
  ): Promise<PlanForwardDetails | null> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        bots: {
          include: {
            follower: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
            missions: {
              include: {
                tasks: {
                  include: {
                    action: true,
                    followerActions: {
                      include: {
                        action: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!plan) {
      throw new Error('Plan not found');
    }

    if (plan.userId !== userId) {
      throw new Error('Unauthorized User');
    }

    return plan;
  }

  async getPlanBotGroups(
    userId: string,
    planId: number,
    page: number,
    pageSize: number,
    hideDead: boolean,
  ): Promise<BotGroupPaginatedResponse> {
    await this.checkAuthorization(userId, planId);

    const bots = await this.prisma.bot.findMany({
      where: {
        planId,
        ...(hideDead && { status: { not: BotStatus.Dead } }),
      },
      orderBy: { id: 'asc' },
      include: {
        follower: true,
        strategy: true,
        leaderContract: true,
        followerContract: true,
        missions: {
          include: {
            tasks: {
              include: {
                action: true,
                followerActions: {
                  include: {
                    action: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    const groupMap = new Map<
      string,
      {
        leaderAddress: string;
        platform: Platform;
        hasDefault: boolean;
        bots: typeof bots;
      }
    >();

    for (const bot of bots) {
      const key = `${bot.leaderAddress.toLowerCase()}-${bot.leaderContract.platform}`;
      const existing = groupMap.get(key);

      if (existing) {
        existing.bots.push(bot);
      } else {
        groupMap.set(key, {
          leaderAddress: bot.leaderAddress,
          platform: bot.leaderContract.platform,
          hasDefault: false,
          bots: [bot],
        });
      }

      try {
        const params = JSON.parse(bot.strategy.params);
        if (!params.mode) {
          groupMap.get(key)!.hasDefault = true;
        }
      } catch {
        groupMap.get(key)!.hasDefault = true;
      }
    }

    const sortedGroups = Array.from(groupMap.values()).sort((a, b) =>
      a.hasDefault === b.hasDefault ? 0 : a.hasDefault ? -1 : 1,
    );

    const totalGroups = sortedGroups.length;
    const totalPages = Math.ceil(totalGroups / pageSize);
    const startIndex = (page - 1) * pageSize;
    const items = sortedGroups.slice(startIndex, startIndex + pageSize);

    return {
      items,
      totalGroups,
      totalPages,
      currentPage: page,
    };
  }

  private async _start(id: number): Promise<boolean> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        bots: {
          include: {
            follower: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
            plan: true,
          },
        },
      },
    });

    if (!plan || plan.status !== PlanStatus.Created) {
      throw new Error('Plan is not in created status');
    }

    await this.botService.batchLiveBots(
      plan.bots.filter((bot) => bot.status === BotStatus.Created),
    );

    await this._update({
      id,
      status: PlanStatus.Started,
      startedAt: new Date(),
    });

    return true;
  }

  async start(userId: string, id: number): Promise<boolean> {
    await this.checkAuthorization(userId, id);

    return await this._start(id);
  }

  private async _end(id: number): Promise<boolean> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        bots: {
          include: {
            follower: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
            plan: true,
          },
        },
      },
    });

    if (!plan || plan.status !== PlanStatus.Started) {
      throw new Error('Plan is not in started status');
    }

    await this.botService.batchStopBots(
      plan.bots.filter((bot) => bot.status === BotStatus.Live),
    );

    await this._update({
      id,
      status: PlanStatus.Stopped,
      endedAt: new Date(),
    });

    return true;
  }

  async end(userId: string, id: number): Promise<boolean> {
    await this.checkAuthorization(userId, id);

    return await this._end(id);
  }

  async checkAndUpdateAllPlans() {
    this.status = ServiceStatus.PROCESS;

    try {
      const plans = await this.prisma.plan.findMany({
        where: {
          status: {
            not: PlanStatus.Finished,
          },
        },
        include: {
          bots: true,
        },
      });

      const now = Date.now();

      for (const plan of plans) {
        if (plan.status === PlanStatus.Stopped) {
          const allBotsDead = plan.bots.every(
            (bot) => bot.status === BotStatus.Dead,
          );

          if (allBotsDead) {
            await this._update({
              id: plan.id,
              status: PlanStatus.Finished,
            });
          }
        } else if (plan.status === PlanStatus.Started) {
          if (now > plan.scheduledEnd.getTime()) {
            await this._end(plan.id);
          }
        } else if (plan.status === PlanStatus.Created) {
          if (now > plan.scheduledStart.getTime()) {
            await this._start(plan.id);
          }
        }
      }
    } catch (err) {
      console.log(err);

      await this.logger.log({
        severity: 'Error',
        summary: 'PlansService>checkAndUpdateAllPlans',
        details: getReadableError(err),
      });
    }

    this.status = ServiceStatus.READY;
  }
}

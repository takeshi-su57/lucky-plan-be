import { Injectable, Inject } from '@nestjs/common';
import { BotStatus, Platform, PlanStatus } from 'generated/prisma/client';
import { ClientProxy } from '@nestjs/microservices';

import { CreatePlanInput, UpdatePlanInput } from './dto/plan.input';
import {
  PlanConnection,
  PlanForwardDetails,
  Plan,
  BotGroupConnection,
} from './entities/plan.entity';

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
    first: number,
    after: number | null,
    hideDead: boolean,
  ): Promise<BotGroupConnection> {
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

    const startIndex = after !== null && after !== undefined ? after + 1 : 0;
    const sliced = sortedGroups.slice(startIndex, startIndex + first);

    const edges = sliced.map((group, i) => ({
      cursor: startIndex + i,
      node: group,
    }));

    const lastCursor =
      edges.length > 0 ? edges[edges.length - 1].cursor : null;
    const hasNextPage =
      lastCursor !== null && lastCursor < sortedGroups.length - 1;

    return {
      edges,
      pageInfo: {
        hasNextPage,
        endCursor: lastCursor,
      },
      totalGroups: sortedGroups.length,
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

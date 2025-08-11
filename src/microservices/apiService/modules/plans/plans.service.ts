import { Injectable, Inject } from '@nestjs/common';
import { BotStatus, PlanStatus } from '@prisma/client';
import { ClientProxy } from '@nestjs/microservices';

import { CreatePlanInput, UpdatePlanInput } from './dto/plan.input';
import {
  PlanConnection,
  PlanForwardDetails,
  Plan,
} from './entities/plan.entity';

import { PrismaService } from 'src/global/prisma.service';
import { BotsService } from 'src/microservices/apiService/modules/bots/bots.service';
import { getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

@Injectable()
export class PlansService {
  status: 'ready' | 'progress' = 'ready';

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

    this.redisClient.emit(PATTERNS.Plans.PlanCreated, plan);

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

    this.redisClient.emit(PATTERNS.Plans.PlanUpdated, plan);

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
      orderBy: { startedAt: 'desc' },
      include: {
        bots: {
          include: {
            follower: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
            missions: {
              include: {
                targetPosition: true,
                achievePosition: true,
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
                targetPosition: true,
                achievePosition: true,
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

  private async _start(id: number): Promise<boolean> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        bots: true,
      },
    });

    if (!plan || plan.status !== PlanStatus.Created) {
      throw new Error('Plan is not in created status');
    }

    for (const bot of plan.bots) {
      if (bot.status === BotStatus.Created) {
        await this.botService.live(plan.userId, bot.id);
      }
    }

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
        bots: true,
      },
    });

    if (!plan || plan.status !== PlanStatus.Started) {
      throw new Error('Plan is not in started status');
    }

    for (const bot of plan.bots) {
      if (bot.status === BotStatus.Live) {
        await this.botService.stop(plan.userId, bot.id);
      }
    }

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
    this.status = 'progress';

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
      await this.logger.log({
        severity: 'Error',
        summary: 'PlansService>checkAndUpdateAllPlans',
        details: getReadableError(err),
      });
    }

    this.status = 'ready';
  }
}

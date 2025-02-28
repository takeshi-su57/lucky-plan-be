import { Injectable, Logger } from '@nestjs/common';
import { BotStatus, PlanStatus } from '@prisma/client';

import { CreatePlanInput, UpdatePlanInput } from './dto/plan.input';
import { PlanConnection, PlanForwardDetails } from './entities/plan.entity';

import { PrismaService } from 'src/global/prisma.service';
import { BotsService } from 'src/bots/bots.service';
import { getReadableError } from 'src/utils';

@Injectable()
export class PlansService {
  status: 'ready' | 'progress' = 'ready';

  constructor(
    private readonly prisma: PrismaService,
    private readonly botService: BotsService,
    private logger: Logger,
  ) {}

  async create(createPlanInput: CreatePlanInput): Promise<PlanForwardDetails> {
    return await this.prisma.plan.create({
      data: {
        ...createPlanInput,
        status: PlanStatus.Created,
      },
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
  }

  async delete(id: number): Promise<number> {
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

  async update(input: UpdatePlanInput): Promise<PlanForwardDetails> {
    return await this.prisma.plan.update({
      where: { id: input.id },
      data: input,
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
  }

  async addBotsToPlan(
    planId: number,
    botIds: number[],
  ): Promise<PlanForwardDetails> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new Error('Plan not found');
    }

    if (plan.status === PlanStatus.Started) {
      const botsPromises = botIds.map(async (botId) => {
        await this.botService.live(botId);
      });

      await Promise.allSettled(botsPromises);
    }

    if (plan.status === PlanStatus.Stopped) {
      const botsPromises = botIds.map(async (botId) => {
        await this.botService.stop(botId);
      });

      await Promise.allSettled(botsPromises);
    }

    return await this.prisma.plan.update({
      where: { id: planId },
      data: { bots: { connect: botIds.map((botId) => ({ id: botId })) } },
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
  }

  async getPlansByStatus(
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
      where: { status },
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

  async getPlanById(id: number): Promise<PlanForwardDetails | null> {
    return await this.prisma.plan.findUnique({
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
  }

  async start(id: number): Promise<PlanForwardDetails> {
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
        await this.botService.live(bot.id);
      }
    }

    return await this.prisma.plan.update({
      where: { id },
      data: { status: PlanStatus.Started, startedAt: new Date() },
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
  }

  async end(id: number): Promise<PlanForwardDetails> {
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
        await this.botService.stop(bot.id);
      }
    }

    return await this.prisma.plan.update({
      where: { id },
      data: { status: PlanStatus.Stopped, endedAt: new Date() },
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
            await this.update({
              id: plan.id,
              status: PlanStatus.Finished,
            });
          }
        } else if (plan.status === PlanStatus.Started) {
          if (now > plan.scheduledEnd.getTime()) {
            await this.end(plan.id);
          }
        } else if (plan.status === PlanStatus.Created) {
          if (now > plan.scheduledStart.getTime()) {
            await this.start(plan.id);
          }
        }
      }
    } catch (err) {
      this.logger.error(
        `Plans Service checkAndUpdateAllPlans> ${getReadableError(err)}`,
      );
    }

    this.status = 'ready';
  }
}

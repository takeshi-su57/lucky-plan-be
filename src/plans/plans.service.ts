import { Injectable, Logger } from '@nestjs/common';
import { BotStatus, PlanStatus } from '@prisma/client';

import { CreatePlanInput, UpdatePlanInput } from './dto/plan.input';
import { PlanDetails } from './entities/plan.entity';

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

  async create(createPlanInput: CreatePlanInput): Promise<PlanDetails> {
    return await this.prisma.plan.create({
      data: {
        ...createPlanInput,
        status: PlanStatus.Created,
      },
      include: {
        bots: {
          include: {
            follower: true,
            leader: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
          },
        },
      },
    });
  }

  async update(input: UpdatePlanInput): Promise<PlanDetails> {
    return await this.prisma.plan.update({
      where: { id: input.id },
      data: input,
      include: {
        bots: {
          include: {
            follower: true,
            leader: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
          },
        },
      },
    });
  }

  async addBotToPlan(planId: number, botId: number): Promise<PlanDetails> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
    });

    if (!plan) {
      throw new Error('Plan not found');
    }

    if (plan.status === PlanStatus.Started) {
      await this.botService.live(botId);
    }

    if (plan.status === PlanStatus.Stopped) {
      await this.botService.stop(botId);
    }

    return await this.prisma.plan.update({
      where: { id: planId },

      data: { bots: { connect: { id: botId } } },
      include: {
        bots: {
          include: {
            follower: true,
            leader: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
          },
        },
      },
    });
  }

  async getPlansByStatus(status: PlanStatus): Promise<PlanDetails[]> {
    return this.prisma.plan.findMany({
      where: { status },
      include: {
        bots: {
          include: {
            follower: true,
            leader: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
          },
        },
      },
    });
  }

  async getPlanById(id: number): Promise<PlanDetails | null> {
    return await this.prisma.plan.findUnique({
      where: { id },
      include: {
        bots: {
          include: {
            follower: true,
            leader: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
          },
        },
      },
    });
  }

  async start(id: number): Promise<PlanDetails> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        bots: true,
      },
    });

    if (!plan || plan.status !== PlanStatus.Created) {
      throw new Error('Plan is not in created status');
    }

    const botsPromises = plan.bots.map(async (bot) => {
      if (bot.status === BotStatus.Created) {
        await this.botService.live(bot.id);
      }
    });

    await Promise.all(botsPromises);

    return await this.prisma.plan.update({
      where: { id },

      data: { status: PlanStatus.Started, startedAt: new Date() },
      include: {
        bots: {
          include: {
            follower: true,
            leader: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
          },
        },
      },
    });
  }

  async end(id: number): Promise<PlanDetails> {
    const plan = await this.prisma.plan.findUnique({
      where: { id },
      include: {
        bots: true,
      },
    });

    if (!plan || plan.status !== PlanStatus.Started) {
      throw new Error('Plan is not in started status');
    }

    const botsPromises = plan.bots.map(async (bot) => {
      if (bot.status === BotStatus.Live) {
        await this.botService.stop(bot.id);
      }
    });

    await Promise.all(botsPromises);

    return await this.prisma.plan.update({
      where: { id },

      data: { status: PlanStatus.Stopped, endedAt: new Date() },
      include: {
        bots: {
          include: {
            follower: true,
            leader: true,
            strategy: true,
            leaderContract: true,
            followerContract: true,
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

      const plansPromises = plans.map(async (plan) => {
        if (plan.status === PlanStatus.Stopped) {
          const allBotsDead = plan.bots.every(
            (bot) => bot.status === BotStatus.Dead,
          );

          if (allBotsDead) {
            await this.update({
              ...plan,
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
      });

      await Promise.all(plansPromises);
    } catch (err) {
      this.logger.error(
        `Plans Service checkAndUpdateAllPlans> ${getReadableError(err)}`,
      );
    }

    this.status = 'ready';
  }
}

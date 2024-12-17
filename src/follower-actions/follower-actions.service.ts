import { Inject, Injectable } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';

import { PrismaService } from 'src/global/prisma.service';
import { PUB_SUB } from 'src/global/global.module';

import { CreateFollowerActionInput } from './dto/follower-action.input';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';

@Injectable()
export class FollowerActionsService {
  constructor(
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private prismaService: PrismaService,
  ) {}

  async createMany(inputs: CreateFollowerActionInput[]) {
    const actions = await this.prismaService.followerAction.createManyAndReturn(
      {
        data: inputs,
        include: {
          action: true,
          task: true,
        },
      },
    );

    this.pubSub.publish(SUBSCRIPTION_TOKEN.followerActionAdded, {
      [SUBSCRIPTION_TOKEN.followerActionAdded]: actions,
    });

    return actions;
  }

  findAll() {
    return this.prismaService.followerAction.findMany();
  }

  findByActionId(actionId: number) {
    return this.prismaService.followerAction.findUnique({
      where: { actionId },
      include: { action: true, task: true },
    });
  }

  findOne(id: number) {
    return this.prismaService.followerAction.findUnique({
      where: { id },
      include: { action: true, task: true },
    });
  }
}

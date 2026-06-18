import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { CreateFollowerActionInput } from './dto/follower-action.input';

@Injectable()
export class FollowerActionsService {
  constructor(private prismaService: PrismaService) {}

  async createMany(inputs: CreateFollowerActionInput[]) {
    if (inputs.length === 0) {
      return [];
    }

    await this.prismaService.followerAction.createMany({
      data: inputs,
      skipDuplicates: true,
    });

    const actions = await this.prismaService.followerAction.findMany({
      where: {
        OR: inputs.map((input) => ({
          actionId: input.actionId,
          taskId: input.taskId,
        })),
      },
      include: {
        action: true,
        task: true,
      },
    });

    return actions;
  }
}

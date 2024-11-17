import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { CreateFollowerActionInput } from './dto/follower-action.input';

@Injectable()
export class FollowerActionsService {
  constructor(private prismaService: PrismaService) {}

  async createMany(inputs: CreateFollowerActionInput[]) {
    return await this.prismaService.followerAction.createManyAndReturn({
      data: inputs,
      include: {
        action: true,
        task: true,
      },
    });
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

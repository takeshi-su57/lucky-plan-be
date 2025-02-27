import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { CreateFollowerActionInput } from './dto/follower-action.input';

@Injectable()
export class FollowerActionsService {
  constructor(private prismaService: PrismaService) {}

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

    return actions;
  }
}

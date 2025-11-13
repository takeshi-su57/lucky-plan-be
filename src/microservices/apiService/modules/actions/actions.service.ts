import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import { CreateActionInput } from './dto/action.input';
import { CloseMissionAction, OpenMissionAction } from 'src/utils/constants';
import { OpenMissionActionArgs } from 'src/types';

@Injectable()
export class ActionsService {
  constructor(private prismaService: PrismaService) {}

  async createCloseMissionAction(
    address: string,
    positionKey: string,
    expectedPrice: string,
  ) {
    const action = await this.prismaService.action.create({
      data: {
        name: CloseMissionAction,
        positionKey,
        address,
        args: JSON.stringify({
          expectedPrice,
        }),
        blockNumber: 0,
        orderInBlock: 0,
      },
    });

    return action;
  }

  async createOpenMissionAction(
    address: string,
    positionKey: string,
    params: OpenMissionActionArgs,
    blockNumber: number,
    orderInBlock: number,
  ) {
    const action = await this.prismaService.action.create({
      data: {
        name: OpenMissionAction,
        positionKey,
        address,
        args: JSON.stringify(params),
        blockNumber,
        orderInBlock,
      },
    });

    return action;
  }

  async createMany(inputs: CreateActionInput[]) {
    if (inputs.length === 0) {
      return [];
    }

    const actions = await this.prismaService.action.createManyAndReturn({
      data: inputs,
    });

    return actions;
  }
}

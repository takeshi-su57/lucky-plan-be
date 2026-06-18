import { Injectable } from '@nestjs/common';
import { ActionOrigin, ActionProcessingStatus } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';

import { CreateActionInput } from './dto/action.input';
import { CloseMissionAction, OpenMissionAction } from 'src/utils/constants';
import { OpenMissionActionArgs } from 'src/types';

@Injectable()
export class ActionsService {
  constructor(private prismaService: PrismaService) {}

  private getActionLookup(input: CreateActionInput) {
    if (input.dedupeKey) {
      return { dedupeKey: input.dedupeKey };
    }

    if (input.contractId !== undefined && input.contractId !== null) {
      return {
        contractId: input.contractId,
        blockNumber: input.blockNumber,
        orderInBlock: input.orderInBlock,
      };
    }

    return null;
  }

  async createCloseMissionAction(
    address: string,
    positionKey: string,
    expectedPrice: string,
  ) {
    const dedupeKey = `system-close:${positionKey}:${expectedPrice}`;

    const action = await this.prismaService.action.upsert({
      where: {
        dedupeKey,
      },
      create: {
        name: CloseMissionAction,
        positionKey,
        address,
        args: JSON.stringify({
          expectedPrice,
        }),
        origin: ActionOrigin.System,
        dedupeKey,
        blockNumber: 0,
        orderInBlock: 0,
      },
      update: {},
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
    const dedupeKey = `clone-open:${positionKey}:${blockNumber}:${orderInBlock}:${JSON.stringify(params)}`;

    const action = await this.prismaService.action.upsert({
      where: {
        dedupeKey,
      },
      create: {
        name: OpenMissionAction,
        positionKey,
        address,
        args: JSON.stringify(params),
        origin: ActionOrigin.Clone,
        dedupeKey,
        blockNumber,
        orderInBlock,
      },
      update: {},
    });

    return action;
  }

  async createMany(inputs: CreateActionInput[]) {
    if (inputs.length === 0) {
      return [];
    }

    const lookups = inputs
      .map((input) => this.getActionLookup(input))
      .filter((item) => !!item);

    if (lookups.length === 0) {
      return await this.prismaService.action.createManyAndReturn({
        data: inputs,
      });
    }

    await this.prismaService.action.createMany({
      data: inputs,
      skipDuplicates: true,
    });

    const actions = await this.prismaService.action.findMany({
      where: {
        OR: lookups,
      },
      orderBy: [{ blockNumber: 'asc' }, { orderInBlock: 'asc' }, { id: 'asc' }],
    });

    return actions;
  }

  async createManyForContract(contractId: number, inputs: CreateActionInput[]) {
    return await this.createMany(
      inputs.map((input) => ({
        ...input,
        contractId,
        origin: ActionOrigin.Chain,
      })),
    );
  }

  async getUnprocessedActions<T extends { id: number }>(
    actions: T[],
    processor: string,
  ): Promise<T[]> {
    if (actions.length === 0) {
      return [];
    }

    await this.prismaService.actionProcessing.createMany({
      data: actions.map((action) => ({
        actionId: action.id,
        processor,
        status: ActionProcessingStatus.Pending,
      })),
      skipDuplicates: true,
    });

    const processings = await this.prismaService.actionProcessing.findMany({
      where: {
        actionId: {
          in: actions.map((action) => action.id),
        },
        processor,
        status: {
          in: [ActionProcessingStatus.Pending, ActionProcessingStatus.Failed],
        },
      },
      select: {
        actionId: true,
      },
    });

    const actionIds = new Set(processings.map((item) => item.actionId));

    return actions.filter((action) => actionIds.has(action.id));
  }

  async markActionsProcessed(actionIds: number[], processor: string) {
    if (actionIds.length === 0) {
      return;
    }

    await this.prismaService.actionProcessing.updateMany({
      where: {
        actionId: {
          in: actionIds,
        },
        processor,
      },
      data: {
        status: ActionProcessingStatus.Processed,
        error: null,
        processedAt: new Date(),
      },
    });
  }

  async markActionsFailed(
    actionIds: number[],
    processor: string,
    error: string,
  ) {
    if (actionIds.length === 0) {
      return;
    }

    await this.prismaService.actionProcessing.updateMany({
      where: {
        actionId: {
          in: actionIds,
        },
        processor,
      },
      data: {
        status: ActionProcessingStatus.Failed,
        error,
      },
    });
  }
}

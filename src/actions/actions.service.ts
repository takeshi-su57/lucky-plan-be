import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { PositionsService } from 'src/positions/positions.service';
import { Position, PositionInfo } from 'src/positions/entities/position.entity';

import { CreateActionInput } from './dto/action.input';
import { ActionDetails } from './entities/action.entity';
import { CloseMissionAction } from 'src/utils/constants';

@Injectable()
export class ActionsService {
  constructor(
    private prismaService: PrismaService,
    private positionsService: PositionsService,
  ) {}

  createCloseMissionAction(positionId: number, expectedPrice: string) {
    return this.prismaService.action.create({
      data: {
        name: CloseMissionAction,
        positionId,
        args: JSON.stringify({
          expectedPrice,
        }),
        blockNumber: 0,
        orderInBlock: 0,
      },
    });
  }

  async createMany(contractId: number, inputs: CreateActionInput[]) {
    const positionInputs = Array.from(
      new Set(
        inputs.map((input) =>
          JSON.stringify({
            contractId,
            address: input.positionAddress.toLowerCase(),
            index: input.positionIndex,
          }),
        ),
      ),
    ).map((item) => JSON.parse(item) as PositionInfo);

    const positionsMap = new Map<string, Position>();

    (await this.positionsService.upsertMany(positionInputs)).forEach(
      (position) =>
        positionsMap.set(
          `${contractId}-${position.address.toLowerCase()}-${position.index}`,
          position as Position,
        ),
    );

    return (await this.prismaService.action.createManyAndReturn({
      data: inputs.map((input) => ({
        name: input.name,
        positionId: positionsMap.get(
          `${contractId}-${input.positionAddress.toLowerCase()}-${input.positionIndex}`,
        )!.id,
        args: input.args,
        blockNumber: input.blockNumber,
        orderInBlock: input.orderInBlock,
      })),
      include: {
        position: true,
      },
    })) as ActionDetails[];
  }

  findAll() {
    return this.prismaService.action.findMany();
  }

  findByPosition(positionId: number) {
    return this.prismaService.action.findMany({ where: { positionId } });
  }

  findOne(id: number) {
    return this.prismaService.action.findUnique({ where: { id } });
  }
}

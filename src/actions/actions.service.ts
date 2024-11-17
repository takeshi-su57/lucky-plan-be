import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { PositionsService } from 'src/positions/positions.service';
import { Position, PositionInfo } from 'src/positions/entities/position.entity';

import { CreateActionInput } from './dto/action.input';
import { ActionDetails } from './entities/action.entity';

@Injectable()
export class ActionsService {
  constructor(
    private prismaService: PrismaService,
    private positionsService: PositionsService,
  ) {}

  async createMany(inputs: CreateActionInput[]) {
    const positionInputs = Array.from(
      new Set(
        inputs.map((input) =>
          JSON.stringify({
            address: input.positionAddress,
            index: input.positionIndex,
          }),
        ),
      ),
    ).map((item) => JSON.parse(item) as PositionInfo);

    const positionsMap = new Map<string, Position>();

    (await this.positionsService.upsertMany(positionInputs)).forEach(
      (position) =>
        positionsMap.set(
          `${position.address}-${position.index}`,
          position as Position,
        ),
    );

    return (await this.prismaService.action.createManyAndReturn({
      data: inputs.map((input) => ({
        name: input.name,
        positionId: positionsMap.get(
          `${input.positionAddress}-${input.positionIndex}`,
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

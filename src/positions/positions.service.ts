import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { CreatePositionInput } from './dto/position.input';

@Injectable()
export class PositionsService {
  constructor(private prismaService: PrismaService) {}

  upsertMany(positions: CreatePositionInput[]) {
    return this.prismaService.$transaction(
      positions.map((position) =>
        this.prismaService.position.upsert({
          where: {
            contractId_address_index: {
              contractId: position.contractId,
              address: position.address.toLowerCase(),
              index: position.index,
            },
          },
          update: {},
          create: {
            contractId: position.contractId,
            address: position.address.toLowerCase(),
            index: position.index,
          },
        }),
      ),
    );
  }
}

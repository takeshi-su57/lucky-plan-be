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
            address_index: position,
          },
          update: {},
          create: position,
        }),
      ),
    );
  }

  findAll() {
    return this.prismaService.position.findMany();
  }

  findOne(id: number) {
    return this.prismaService.position.findUnique({ where: { id } });
  }

  find(address: string, index: number) {
    return this.prismaService.position.findFirst({
      where: { address: address, index: index },
    });
  }
}

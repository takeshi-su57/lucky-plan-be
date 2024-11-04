import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { CreatePositionInput } from './dto/position.input';
import { Address } from 'viem';

@Injectable()
export class PositionsService {
  constructor(private prismaService: PrismaService) {}

  create(input: CreatePositionInput) {
    return this.prismaService.position.create({
      data: input,
    });
  }

  findAll() {
    return this.prismaService.position.findMany();
  }

  findOne(id: number) {
    return this.prismaService.position.findUnique({ where: { id } });
  }

  find(address: Address, index: number) {
    return this.prismaService.position.findFirst({
      where: { address: address, index: index },
    });
  }
}

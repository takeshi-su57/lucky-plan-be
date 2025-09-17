import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { CreateStrategyInput, UpdateStrategyInput } from './dto/strategy.input';

@Injectable()
export class StrategyService {
  constructor(private prismaService: PrismaService) {}

  create(input: CreateStrategyInput) {
    return this.prismaService.strategy.create({
      data: input,
    });
  }

  update(id: number, input: UpdateStrategyInput) {
    return this.prismaService.strategy.update({
      where: { id },
      data: input,
    });
  }

  findAll() {
    return this.prismaService.strategy.findMany();
  }

  findOne(id: number) {
    return this.prismaService.strategy.findUnique({
      where: { id },
    });
  }

  remove(id: number) {
    return this.prismaService.strategy.delete({
      where: { id },
    });
  }
}

import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { CreateContractInput, UpdateContractInput } from './dto/contract.input';

@Injectable()
export class ContractsService {
  constructor(private prismaService: PrismaService) {}

  create(input: CreateContractInput) {
    return this.prismaService.contract.create({
      data: input,
    });
  }

  findAll() {
    return this.prismaService.contract.findMany();
  }

  findOne(id: number) {
    return this.prismaService.contract.findUnique({ where: { id } });
  }

  update(id: number, input: UpdateContractInput) {
    return this.prismaService.contract.update({ where: { id }, data: input });
  }

  remove(id: number) {
    return this.prismaService.contract.delete({ where: { id } });
  }
}

import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { CreateContractInput } from './dto/contract.input';
import { ChainsService } from './chains.service';

@Injectable()
export class ContractsService {
  constructor(
    private prismaService: PrismaService,
    private chainsService: ChainsService,
  ) {}

  create(input: CreateContractInput) {
    if (!this.chainsService.isValidChainId(input.chainId)) {
      throw new Error('Invalid chain Id');
    }

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
}

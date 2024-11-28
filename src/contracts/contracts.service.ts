import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import {
  CreateContractInput,
  ChangeContractStatusInput,
} from './dto/contract.input';
import { ChainsService } from '../global/chains.service';

@Injectable()
export class ContractsService {
  constructor(
    private prismaService: PrismaService,
    private chainsService: ChainsService,
  ) {}

  async create(input: CreateContractInput) {
    if (!this.chainsService.isValidChainId(input.chainId)) {
      throw new Error('Invalid chain Id');
    }

    const publicClient = this.chainsService.publicClient(input.chainId);

    const blockNumber = await publicClient.getBlockNumber();

    return await this.prismaService.contract.create({
      data: {
        ...input,
        address: input.address.toLowerCase(),
        lastBlockNumber: Number(blockNumber),
      },
    });
  }

  async changeStatus(input: ChangeContractStatusInput) {
    return this.prismaService.contract.update({
      where: { id: input.id },
      data: {
        status: input.status,
      },
    });
  }

  updateLastBlockNumber(id: number, lastBlockNumber: number) {
    return this.prismaService.contract.update({
      where: { id },
      data: {
        lastBlockNumber,
      },
    });
  }

  findAll() {
    return this.prismaService.contract.findMany();
  }

  async findOne(id: number) {
    const contract = await this.prismaService.contract.findUnique({
      where: { id },
    });

    if (!contract) {
      throw new Error('Invalid contract id');
    }

    return contract;
  }
}

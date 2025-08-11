import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';

import {
  CreateContractInput,
  ChangeContractStatusInput,
} from './dto/contract.input';

@Injectable()
export class ContractsService {
  constructor(private prismaService: PrismaService) {}

  async create(input: CreateContractInput) {
    return await this.prismaService.contract.create({
      data: {
        ...input,
        address: input.address.toLowerCase(),
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

  updateLastLeaderboardBlockNumber(
    id: number,
    lastLeaderboardBlockNumber: number,
  ) {
    return this.prismaService.contract.update({
      where: { id },
      data: {
        lastLeaderboardBlockNumber,
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

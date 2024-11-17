import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { CreateContractInput } from './dto/contract.input';
import { ChainsService } from '../global/chains.service';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';

@Injectable()
export class ContractsService {
  constructor(
    private prismaService: PrismaService,
    private chainsService: ChainsService,
  ) {
    const publicClient = chainsService.publicClient(42161);

    publicClient
      .readContract({
        address: '0xFF162c694eAA571f685030649814282eA457f169',
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'getCollaterals',
      })
      .then((data) => console.log(data));
  }

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

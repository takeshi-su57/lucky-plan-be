import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { timeout } from 'rxjs';
import { ContractStatus } from 'generated/prisma/client';

import { PrismaService } from 'src/global/prisma.service';

import { ChangeContractStatusInput } from './dto/contract.input';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

@Injectable()
export class ContractsService {
  constructor(
    private prismaService: PrismaService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
  ) {}

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

  async getAdaptionStatus() {
    return await new Promise<string>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Leaderboard.GetAdaptionStatus, {})
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(JSON.stringify(data)),
          error: (err) => reject(err),
        });
    });
  }

  async startAdaption(contractId: number, shouldRestart: boolean) {
    return await new Promise<boolean>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Leaderboard.StartAdaption, { contractId, shouldRestart })
        .pipe(timeout(120_000))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async liveContract(contractId: number, fromBlock: number | null) {
    const contract = await this.findOne(contractId);

    if (contract.status === ContractStatus.Live) {
      throw new Error('Contract is already live');
    }

    if (fromBlock) {
      return await this.prismaService.contract.update({
        where: { id: contractId },
        data: {
          status: ContractStatus.Live,
          lastBlockNumber: fromBlock,
        },
      });
    } else {
      return await this.prismaService.contract.update({
        where: { id: contractId },
        data: {
          status: ContractStatus.Live,
        },
      });
    }
  }

  async disableContract(contractId: number) {
    return await this.prismaService.contract.update({
      where: { id: contractId },
      data: {
        status: ContractStatus.Dead,
      },
    });
  }
}

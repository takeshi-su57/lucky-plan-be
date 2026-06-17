import { Injectable } from '@nestjs/common';
import { Platform } from 'generated/prisma/client';

import { CreatePerpTradingEventLogInput } from './dto/event-logs.input';

import { PrismaService } from 'src/global/prisma.service';
import { PerpTradeHistory } from './entities/event-logs.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { getWeb3Info } from 'src/web3/utils';

@Injectable()
export class EventLogsService {
  constructor(private prismaService: PrismaService) {}

  async createManyPerpTradingEventLogs(
    inputs: CreatePerpTradingEventLogInput[],
  ) {
    if (inputs.length === 0) {
      return [];
    }

    return await this.prismaService.perpTradingEventLog.createManyAndReturn({
      data: inputs.map((input) => ({
        ...input,
      })),
    });
  }

  async getPerpTradeHistories(
    addresses: string[],
    platform: Platform,
  ): Promise<PerpTradeHistory[][]> {
    const result: PerpTradeHistory[][] = [];
    const allContractsMap: Record<string, Contract> = {};
    const testContractIds: number[] = [];

    const allContracts = await this.prismaService.contract.findMany();

    allContracts.forEach((contract) => {
      allContractsMap[contract.id] = contract;

      if (contract.isTestnet) {
        testContractIds.push(contract.id);
      }
    });

    for (const address of addresses) {
      const records = (
        await this.prismaService.perpTradingEventLog.findMany({
          where: {
            address: address.toLowerCase(),
            platform,
          },
          orderBy: [
            {
              date: 'asc',
            },
            {
              block: 'asc',
            },
            {
              id: 'asc',
            },
          ],
        })
      ).filter((item) => !testContractIds.includes(item.contractId));

      result.push(
        records
          .map((record) => {
            const contract = allContractsMap[record.contractId];

            const history = getWeb3Info(
              contract.platform,
              contract.version,
            ).eventToPerpTradeHistory(
              contract.chainId,
              JSON.parse(record.jsonLog) as any,
            );

            return history
              ? { ...history, id: record.id, date: record.date }
              : null;
          })
          .filter((item) => !!item),
      );
    }

    return result;
  }
}

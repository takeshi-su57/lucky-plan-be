import { Injectable } from '@nestjs/common';
import { Platform } from 'generated/prisma/client';

import {
  CreateEventLogInput,
  CreatePerpTradingEventLogInput,
} from './dto/event-logs.input';

import { PrismaService } from 'src/global/prisma.service';
import { PerpTradingEventLog } from './entities/event-logs.entity';

@Injectable()
export class EventLogsService {
  constructor(private prismaService: PrismaService) {}

  async createManyEventLogs(inputs: CreateEventLogInput[]) {
    if (inputs.length === 0) {
      return [];
    }

    return await this.prismaService.eventLog.createManyAndReturn({
      data: inputs.map((input) => ({
        ...input,
      })),
    });
  }

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

  async getPerpEventLogs(
    addresses: string[],
    platform: Platform,
    limit: number | null,
  ): Promise<PerpTradingEventLog[][]> {
    const result: PerpTradingEventLog[][] = [];

    const testContracts = await this.prismaService.contract.findMany({
      where: {
        isTestnet: true,
      },
    });

    const testContractIds = testContracts.map((item) => item.id);

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
        limit
          ? records.slice(Math.max(0, records.length - limit), records.length)
          : records,
      );
    }

    return result;
  }
}

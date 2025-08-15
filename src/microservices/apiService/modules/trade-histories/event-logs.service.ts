import { Injectable } from '@nestjs/common';

import {
  CreateEventLogInput,
  CreatePerpTradingEventLogInput,
} from './dto/event-logs.input';

import { PrismaService } from 'src/global/prisma.service';
import { Platform } from '@prisma/client';
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
  ): Promise<PerpTradingEventLog[]> {
    return await this.prismaService.perpTradingEventLog.findMany({
      where: {
        address: {
          in: addresses.map((address) => address.toLowerCase()),
        },
        platform,
      },
    });
  }
}

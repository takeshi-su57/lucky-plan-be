import { Injectable } from '@nestjs/common';
import * as WebSocket from 'ws';
import { arbitrum } from 'viem/chains';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';

import { CreateGnsPriceInput } from './dto/price.input';

import { getPairName } from 'src/web3/platform/gns/v10/configs';

@Injectable()
export class PricesService {
  constructor(
    private prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  async createGnsPrices(prices: CreateGnsPriceInput[]) {
    return this.prismaService.gnsPricingRecord.createMany({
      data: prices,
    });
  }

  async getLastPrices(pairName: string, lastDate: Date) {
    return this.prismaService.gnsPricingRecord.findMany({
      where: {
        pair: pairName,
        date: {
          gte: lastDate,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });
  }

  async getGnsPrices(pairName: string, fromDate: Date, toDate: Date) {
    return this.prismaService.gnsPricingRecord.findMany({
      where: {
        pair: pairName,
        date: {
          gte: fromDate,
          lte: toDate,
        },
      },
      orderBy: {
        date: 'asc',
      },
    });
  }

  connectToGnsPriceWsServer() {
    const websocket = new WebSocket('wss://backend-pricing.eu.gains.trade/v3', {
      perMessageDeflate: false,
    });

    websocket.on('open', () => {
      this.logger.log({
        summary: 'GNS Price WebSocket connect',
        details: 'GNS Price WebSocket connect',
        severity: 'Info',
      });
    });

    websocket.on('message', async (event) => {
      const data: number[] = JSON.parse(event.toString());

      const updatedPrices: Record<string, number> = {};

      for (let i = 0; i < data.length; i += 2) {
        const pairName = getPairName(arbitrum.id, data[i]);

        if (!pairName) {
          continue;
        }

        updatedPrices[pairName] = data[i + 1];
      }

      await this.createGnsPrices(
        Object.entries(updatedPrices).map(([pairName, price]) => ({
          pair: pairName,
          price,
          date: new Date(),
        })),
      );
    });

    websocket.on('close', () => {
      this.logger.log({
        summary: 'GNS Price WebSocket disconnect',
        details: 'GNS Price WebSocket disconnect',
        severity: 'Error',
      });
      setTimeout(() => this.connectToGnsPriceWsServer(), 5_000);
    });

    websocket.on('error', () => {
      this.logger.log({
        summary: 'GNS Price WebSocket error',
        details: 'GNS Price WebSocket error',
        severity: 'Error',
      });
      websocket.close();

      setTimeout(() => this.connectToGnsPriceWsServer(), 5_000);
    });
  }
}

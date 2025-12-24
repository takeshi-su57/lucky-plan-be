import { Injectable } from '@nestjs/common';

import { PrismaService } from 'src/global/prisma.service';
import { Platform } from 'generated/prisma/client';
import { parseGnsPositionKey } from 'src/web3/platform/gns/utils';

import { PricesService } from '../prices/prices.service';

import { SLTPRequestInput } from './dto/sltp.input';
import {
  PercentageCondition,
  PriceConditionParams,
  SLTPCondition,
} from './types';
import { FollowerService } from '../follower/follower.service';
import { getPairIndex } from 'src/web3/platform/gns/v10/configs';

@Injectable()
export class SLTPService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly pricesService: PricesService,
    private readonly followerService: FollowerService,
  ) {}

  async createSLTP(input: SLTPRequestInput) {
    return this.prismaService.sLTPRequest.create({
      data: input,
    });
  }

  async deleteSLTP(id: number) {
    return this.prismaService.sLTPRequest.delete({
      where: { id },
    });
  }

  async getAllSLTPs() {
    return this.prismaService.sLTPRequest.findMany();
  }

  async checkAllSLTPs() {
    const sltpRequests = await this.prismaService.sLTPRequest.findMany({
      include: {
        contract: true,
      },
    });

    for (const sltpRequest of sltpRequests) {
      // for now sltp is only supported for gns
      if (sltpRequest.contract.platform !== Platform.GNS) {
        continue;
      }

      const { address, index } = parseGnsPositionKey(sltpRequest.positionKey);
      const follower = await this.prismaService.follower.findUnique({
        where: {
          address: address.toLowerCase(),
        },
      });

      if (!follower) {
        continue;
      }

      const condition = JSON.parse(sltpRequest.condition) as SLTPCondition;

      const pairIndex = getPairIndex(
        sltpRequest.contract.chainId,
        condition.pair,
      );

      if (pairIndex === -1) {
        continue;
      }

      const prices = await this.pricesService.getLastPrices(
        condition.pair,
        new Date(condition.updatedAt),
      );

      if (prices.length === 0) {
        continue;
      }

      let hasMetCondition: boolean = false;

      const currentPrice = prices[prices.length - 1].price;
      const maxPrice = Math.max(...prices.map((price) => price.price));
      const minPrice = Math.min(...prices.map((price) => price.price));

      if (condition.type === 'price') {
        const { trigger, kind } = condition.params as PriceConditionParams;

        if (kind === 'tp') {
          if (condition.isLong) {
            hasMetCondition = maxPrice >= trigger;
          } else {
            hasMetCondition = minPrice <= trigger;
          }
        } else {
          if (condition.isLong) {
            hasMetCondition = minPrice <= trigger;
          } else {
            hasMetCondition = maxPrice >= trigger;
          }
        }

        if (hasMetCondition) {
          await this.deleteSLTP(sltpRequest.id);
          await this.followerService.closeTradeMarket(follower.userId, {
            address: address.toLowerCase(),
            index,
            contractId: sltpRequest.contractId,
            pairIndex,
          });
        } else {
          await this.prismaService.sLTPRequest.update({
            where: { id: sltpRequest.id },
            data: {
              condition: JSON.stringify({
                ...condition,
                updatedAt: new Date().toISOString(),
              }),
            },
          });
        }
      } else if (condition.type === 'percentage') {
        const { percentage, initialPrice, highestPrice, exceptionPrice } =
          condition.params as PercentageCondition;

        let newHighestPrice = highestPrice;

        if (condition.isLong) {
          newHighestPrice = Math.max(newHighestPrice, maxPrice);

          const delta = newHighestPrice - currentPrice;

          const newPercentage =
            (delta / (newHighestPrice - initialPrice)) * 100;

          hasMetCondition =
            delta > exceptionPrice && newPercentage >= percentage;
        } else {
          newHighestPrice = Math.min(newHighestPrice, minPrice);

          const delta = currentPrice - newHighestPrice;

          const newPercentage =
            (delta / (initialPrice - newHighestPrice)) * 100;

          hasMetCondition =
            delta > exceptionPrice && newPercentage >= percentage;
        }

        if (hasMetCondition) {
          await this.deleteSLTP(sltpRequest.id);
          await this.followerService.closeTradeMarket(follower.userId, {
            address: address.toLowerCase(),
            index,
            contractId: sltpRequest.contractId,
            pairIndex,
          });
        } else {
          await this.prismaService.sLTPRequest.update({
            where: { id: sltpRequest.id },
            data: {
              condition: JSON.stringify({
                ...condition,
                params: {
                  ...(condition.params as PercentageCondition),
                  highestPrice: newHighestPrice,
                },
                updatedAt: new Date().toISOString(),
              }),
            },
          });
        }
      }
    }
  }
}

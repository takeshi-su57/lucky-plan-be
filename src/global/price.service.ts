import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ChainsService } from './chains.service';
import { aggregatorV3InterfaceAbi } from 'src/abi/AggregatorV3Interface';

@Injectable()
export class PriceService {
  private usdcPrice: bigint;
  private readonly USDCPriceFeedAddress =
    '0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3';

  constructor(
    private chainsService: ChainsService,
    private logger: Logger,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async refetchPrices() {
    this.loadUSDCPrice();
  }

  async loadUSDCPrice() {
    try {
      // Fetch the latest round data
      const data = await this.chainsService.publicClient(42161).readContract({
        address: this.USDCPriceFeedAddress,
        abi: aggregatorV3InterfaceAbi,
        functionName: 'latestRoundData',
      });

      this.usdcPrice = data[1];

      // Convert the raw price to a human-readable format
      return data[1];
    } catch (error) {
      this.logger.error('Failed to fetch price data:', error);
      throw new Error('Could not retrieve the latest price');
    }
  }

  async getUSDCPrice() {
    if (this.usdcPrice !== undefined || this.usdcPrice !== null) {
      return this.usdcPrice;
    }

    return this.loadUSDCPrice();
  }
}

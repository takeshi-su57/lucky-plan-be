import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Address } from 'viem';

import { ChainsService } from './chains.service';
import { aggregatorV3InterfaceAbi } from 'src/abi/AggregatorV3Interface';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';

export type Pair = {
  from: string;
  to: string;
  feed: {
    feed1: Address;
    feed2: Address;
    feedCalculation: number;
    maxDeviationP: bigint;
  };
  spreadP: bigint;
  groupIndex: bigint;
  feeIndex: bigint;
  price: bigint;
};

export type Collateral = {
  collateral: Address;
  isActive: boolean;
  __placeholder: bigint;
  precision: bigint;
  precisionDelta: bigint;
  usdPrice: bigint;
};

export type TradingVariable = {
  pairs: Pair[];
  collaterals: Collateral[];
};

const gnsMultiCollatDiamond = '0xFF162c694eAA571f685030649814282eA457f169';

@Injectable()
export class TradingVariableService {
  private tradingVariable: TradingVariable;
  public status: 'ready' | 'process';

  constructor(
    private chainsService: ChainsService,
    private logger: Logger,
  ) {
    this.status = 'process';
    this.loadTradingVariables();
  }

  async loadTradingVariables() {
    const publicClient = this.chainsService.publicClient(42161);

    const refData = await publicClient.multicall({
      contracts: [
        {
          address: gnsMultiCollatDiamond,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'pairsCount',
          args: [],
        },
        {
          address: gnsMultiCollatDiamond,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'getCollaterals',
          args: [],
        },
      ],
    });

    if (refData[0].status === 'failure' || refData[1].status === 'failure') {
      throw new Error('Failed at getting trading variable');
    }

    const pairsData = await publicClient.multicall({
      contracts: Array.from(Array(Number(refData[0].result)).keys()).map(
        (item) =>
          ({
            address: gnsMultiCollatDiamond,
            abi: gnsMultiCollatDiamondAbi,
            functionName: 'pairs',
            args: [BigInt(item + 1)],
          }) as {
            abi: typeof gnsMultiCollatDiamondAbi; // Assuming Abi is correctly defined
            functionName: 'pairs';
            args: [bigint];
            address: Address;
          },
      ),
    });

    const failedPair = pairsData.find((pair) => pair.status === 'failure');

    if (failedPair) {
      throw new Error('Failed at getting trading variable');
    }

    this.tradingVariable = {
      pairs: pairsData.map((item) => ({
        ...item.result!,
        price: 100_000_000n,
      })),
      collaterals: refData[1].result.map((item) => ({
        ...item,
        usdPrice: 100_000_000n,
      })),
    };

    await this.loadPrice();

    this.status = 'ready';
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async refetchPrices() {
    if (this.status === 'ready') {
      this.loadPrice();
    }
  }

  async loadPrice() {
    try {
      const publicClient = this.chainsService.publicClient(42161);

      const feedPriceMap: Record<Address, bigint> = {};

      this.tradingVariable.pairs.forEach((pair) => {
        feedPriceMap[pair.feed.feed1] = 100_000_000n;
        feedPriceMap[pair.feed.feed2] = 100_000_000n;
      });

      // Fetch the latest round data
      const feedData = await publicClient.multicall({
        contracts: Object.keys(feedPriceMap).map((address) => ({
          address: address as Address,
          abi: aggregatorV3InterfaceAbi,
          functionName: 'latestRoundData',
        })),
      });

      Object.keys(feedPriceMap).forEach((address, index) => {
        const item = feedData[index];

        if (item.status === 'success' && Array.isArray(item.result)) {
          feedPriceMap[address as Address] = item.result[1];
        }
      });

      for (let i = 0; i < this.tradingVariable.pairs.length; i++) {
        const pair = this.tradingVariable.pairs[i];

        this.tradingVariable.pairs[i] = {
          ...pair,
          price:
            (feedPriceMap[pair.feed.feed1] * 100_000_000n) /
            feedPriceMap[pair.feed.feed2],
        };
      }

      const collateralFeedData = await publicClient.multicall({
        contracts: this.tradingVariable.collaterals.map(
          (_, index) =>
            ({
              address: gnsMultiCollatDiamond,
              abi: gnsMultiCollatDiamondAbi,
              functionName: 'getCollateralPriceUsd',
              args: [BigInt(index + 1)],
            }) as {
              abi: typeof gnsMultiCollatDiamondAbi; // Assuming Abi is correctly defined
              functionName: 'getCollateralPriceUsd';
              args: [bigint];
              address: Address;
            },
        ),
      });

      for (let i = 0; i < this.tradingVariable.collaterals.length; i++) {
        const collateral = this.tradingVariable.collaterals[i];
        const feed = collateralFeedData[i];

        if (feed.status === 'success') {
          this.tradingVariable.collaterals[i] = {
            ...collateral,
            usdPrice: feed.result,
          };
        }
      }
    } catch (error) {
      this.logger.error('Failed to fetch price data:', error);
    }
  }

  getPair(pairIndex: number) {
    if (!this.tradingVariable) {
      throw new Error('Failed at getting trading variable');
    }

    if (this.tradingVariable.pairs.length < pairIndex || pairIndex === 0) {
      throw new Error('Invalid pair index');
    }

    return this.tradingVariable.pairs[pairIndex - 1];
  }

  getCollateral(collateralIndex: number) {
    if (!this.tradingVariable) {
      throw new Error('Failed at getting trading variable');
    }

    if (
      this.tradingVariable.collaterals.length < collateralIndex ||
      collateralIndex === 0
    ) {
      throw new Error('Invalid collateral index');
    }

    return this.tradingVariable.collaterals[collateralIndex - 1];
  }
}

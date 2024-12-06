import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Address } from 'viem';

import { ChainsService } from './chains.service';
import { aggregatorV3InterfaceAbi } from 'src/abi/AggregatorV3Interface';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { PrismaService } from './prisma.service';
import { Contract } from '@prisma/client';

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

@Injectable()
export class TradingVariableService {
  private tradingVariable: Record<string, TradingVariable> = {};
  public status: 'ready' | 'process' = 'process';
  contracts: Contract[] = [];

  constructor(
    private chainsService: ChainsService,
    private prismaService: PrismaService,
    private logger: Logger,
  ) {
    this.loadTradingVariables();
  }

  async loadTradingVariables() {
    this.status = 'process';

    this.contracts = await this.prismaService.contract.findMany();

    for (const contract of this.contracts) {
      const publicClient = this.chainsService.publicClient(contract.chainId);

      const refData = await publicClient.multicall({
        contracts: [
          {
            address: contract.address as Address,
            abi: gnsMultiCollatDiamondAbi,
            functionName: 'pairsCount',
            args: [],
          },
          {
            address: contract.address as Address,
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
              address: contract.address as Address,
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

      this.tradingVariable[contract.id] = {
        pairs: pairsData.map((item) => ({
          ...item.result!,
          price: 100_000_000n,
        })),
        collaterals: refData[1].result.map((item) => ({
          ...item,
          usdPrice: 100_000_000n,
        })),
      };

      await this.loadPrice(contract);
    }

    this.status = 'ready';
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async refetchPrices() {
    if (this.status === 'ready') {
      for (const contract of this.contracts) {
        this.loadPrice(contract);
      }
    }
  }

  async loadPrice(contract: Contract) {
    this.status = 'process';

    try {
      const publicClient = this.chainsService.publicClient(contract.chainId);

      const feedPriceMap: Record<Address, bigint> = {};

      this.tradingVariable[contract.id].pairs.forEach((pair) => {
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

      for (let i = 0; i < this.tradingVariable[contract.id].pairs.length; i++) {
        const pair = this.tradingVariable[contract.id].pairs[i];

        this.tradingVariable[contract.id].pairs[i] = {
          ...pair,
          price:
            (feedPriceMap[pair.feed.feed1] * 100_000_000n) /
            feedPriceMap[pair.feed.feed2],
        };
      }

      const collateralFeedData = await publicClient.multicall({
        contracts: this.tradingVariable[contract.id].collaterals.map(
          (_, index) =>
            ({
              address: contract.address as Address,
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

      for (
        let i = 0;
        i < this.tradingVariable[contract.id].collaterals.length;
        i++
      ) {
        const collateral = this.tradingVariable[contract.id].collaterals[i];
        const feed = collateralFeedData[i];

        if (feed.status === 'success') {
          this.tradingVariable[contract.id].collaterals[i] = {
            ...collateral,
            usdPrice: feed.result,
          };
        }
      }
    } catch (error) {
      this.logger.error('Failed to fetch price data:', error);
    }

    this.status = 'process';
  }

  getPair(contractId: number, pairIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    if (
      this.tradingVariable[contractId].pairs.length < pairIndex ||
      pairIndex === 0
    ) {
      throw new Error('Invalid pair index');
    }

    return this.tradingVariable[contractId].pairs[pairIndex - 1];
  }

  getCollateral(contractId: number, collateralIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    if (
      this.tradingVariable[contractId].collaterals.length < collateralIndex ||
      collateralIndex === 0
    ) {
      console.log(
        collateralIndex,
        this.tradingVariable[contractId].collaterals.length,
      );
      throw new Error('Invalid collateral index');
    }

    return this.tradingVariable[contractId].collaterals[collateralIndex - 1];
  }
}

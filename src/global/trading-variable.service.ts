import { Injectable } from '@nestjs/common';
import { Address } from 'viem';

import { ChainsService } from './chains.service';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { PrismaService } from './prisma.service';
import { Collateral, Pair } from 'src/types';

import {
  Contract,
  TradeCollateral,
  TradePair,
} from 'src/contracts/entities/contract.entity';

export type TradingVariable = {
  pairs: (Pair | undefined)[];
  collaterals: Collateral[];
};

@Injectable()
export class TradingVariableService {
  private tradingVariable: Record<number, TradingVariable> = {};
  public status: 'ready' | 'process' = 'ready';

  constructor(
    private chainsService: ChainsService,
    private prismaService: PrismaService,
  ) {
    this.status = 'ready';
  }

  async loadTradingVariables() {
    this.status = 'process';

    const contracts = await this.prismaService.contract.findMany();

    this.tradingVariable = {};

    for (const contract of contracts) {
      console.log(
        `Started loading trading variable for contract: ${contract.chainId}`,
      );

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
              args: [BigInt(item)],
            }) as {
              abi: typeof gnsMultiCollatDiamondAbi;
              functionName: 'pairs';
              args: [bigint];
              address: Address;
            },
        ),
      });

      const depthData = await publicClient.readContract({
        address: contract.address as Address,
        abi: gnsMultiCollatDiamondAbi,
        functionName: 'getPairDepths',
        args: [
          Array.from(Array(Number(refData[0].result)).keys()).map((item) =>
            BigInt(item),
          ),
        ],
      });

      const failedPair = pairsData.find((pair) => pair.status === 'failure');

      if (failedPair) {
        throw new Error('Failed at getting trading variable');
      }

      this.tradingVariable[contract.id] = {
        pairs: pairsData
          .map((item) => item.result)
          .filter((item) => item !== undefined)
          .map((item, index) => ({
            ...item,
            depth: depthData[index],
          })),
        collaterals: refData[1].result.map((item) => ({
          ...item,
        })),
      };

      console.log(
        `Ended loading trading variable for contract: ${contract.chainId}`,
      );
    }

    this.status = 'ready';
  }

  async getCollateralPrice(contract: Contract, collateralIndex: number) {
    const publicClient = this.chainsService.publicClient(contract.chainId);

    const collateralFeedData = await publicClient.readContract({
      address: contract.address as Address,
      abi: gnsMultiCollatDiamondAbi,
      functionName: 'getCollateralPriceUsd',
      args: [collateralIndex],
    });

    return collateralFeedData;
  }

  async getPairPrice(pairIndex: number): Promise<bigint> {
    const charts = await fetch(
      'https://backend-pricing.eu.gains.trade/charts',
    ).then((res) => res.json());

    return BigInt(Math.floor(charts.closes[pairIndex] * 1e10));
  }

  getPair(contractId: number, pairIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    return this.tradingVariable[contractId].pairs[pairIndex];
  }

  getPairName(contractId: number, pairIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    const pair = this.tradingVariable[contractId].pairs[pairIndex];

    return `${pair?.from}/${pair?.to}`;
  }

  getTradePairs(contractId: number): TradePair[] {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    return this.tradingVariable[contractId].pairs.map((pair, index) => ({
      pairIndex: index,
      from: pair?.from || '',
      to: pair?.to || '',
    }));
  }

  getCollateral(contractId: number, collateralIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error(`Failed at getting trading variable ${contractId}`);
    }

    if (
      this.tradingVariable[contractId].collaterals.length < collateralIndex ||
      collateralIndex === 0
    ) {
      throw new Error(
        `Invalid collateral index collateralIndex:${collateralIndex}, collateralsLength: ${this.tradingVariable[contractId].collaterals.length}`,
      );
    }

    return this.tradingVariable[contractId].collaterals[collateralIndex - 1];
  }

  getTradeCollaterals(contractId: number): TradeCollateral[] {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    return this.tradingVariable[contractId].collaterals.map(
      (collateral, index) => ({
        collateralIndex: index + 1,
        collateral: collateral.collateral,
        isActive: collateral.isActive,
        precision: collateral.precision.toString(),
        precisionDelta: collateral.precisionDelta.toString(),
      }),
    );
  }
}

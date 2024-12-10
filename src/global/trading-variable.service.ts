import { Injectable, Logger } from '@nestjs/common';
import { Address } from 'viem';

import { ChainsService } from './chains.service';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { PrismaService } from './prisma.service';
import { Collateral } from 'src/types';

import { Contract } from 'src/contracts/entities/contract.entity';

export type TradingVariable = {
  collaterals: Collateral[];
};

@Injectable()
export class TradingVariableService {
  private tradingVariable: Record<number, TradingVariable> = {};
  public status: 'ready' | 'process' = 'process';
  contracts: Contract[] = [];

  constructor(
    private chainsService: ChainsService,
    private prismaService: PrismaService,
    private logger: Logger,
  ) {
    this.tradingVariable = {};
    this.loadTradingVariables();
  }

  async loadTradingVariables() {
    this.status = 'process';

    try {
      this.contracts = await this.prismaService.contract.findMany();

      for (const contract of this.contracts) {
        const publicClient = this.chainsService.publicClient(contract.chainId);

        const collateralData = await publicClient.readContract({
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'getCollaterals',
          args: [],
        });

        this.tradingVariable[contract.id] = {
          collaterals: collateralData.map((item) => ({
            ...item,
            usdPrice: 100_000_000n,
          })),
        };
      }
    } catch (err) {
      this.logger.error(err);
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

  getCollateral(contractId: number, collateralIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error('Failed at getting trading variable');
    }

    if (
      this.tradingVariable[contractId].collaterals.length < collateralIndex ||
      collateralIndex === 0
    ) {
      throw new Error('Invalid collateral index');
    }

    return this.tradingVariable[contractId].collaterals[collateralIndex - 1];
  }
}

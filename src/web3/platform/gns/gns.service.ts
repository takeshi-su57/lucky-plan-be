import { Injectable } from '@nestjs/common';
import { Address, zeroAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { Platform } from '@prisma/client';

import { gnsMultiCollatDiamondAbi } from './v10/abi/GNSMultiCollatDiamond';

import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { ChainsService } from 'src/web3/web3/chains.service';
import { LogsService } from 'src/global/logs.service';
import { PrismaService } from 'src/global/prisma.service';

import {
  OpenTradePayload,
  UpdateMaxClosingSlippagePPayload,
  CloseTradeMarketPayload,
  CancelOrderAfterTimeoutPayload,
  DecreasePositionSizePayload,
  IncreasePositionSizePayload,
  UpdateTpPayload,
  UpdateSlPayload,
  UpdateLeveragePayload,
  GetPendingOrdersPayload,
  GetTradesPayload,
  GetTradePayload,
  GetCollateralPricePayload,
  TradingVariable,
  WithdrawPositivePnlPayload,
} from './v10/types';

import { ChainPriority, ServiceStatus } from 'src/types';
import { Contract } from 'src/microservices/apiService/modules/contracts/entities/contract.entity';
import {
  TradeCollateral,
  TradePair,
} from 'src/microservices/apiService/modules/contracts/entities/contract.entity';
import { bigIntSafeJsonParse, bigIntSafeJsonStringify } from 'src/utils';

const GNS_V10_TRADING_VARIABLES = 'gns_v10_trading_variables';

@Injectable()
export class GnsService {
  private tradingVariable: Record<number, TradingVariable> = {};
  public status: ServiceStatus;

  constructor(
    private readonly contractsService: ContractsService,
    private readonly prismaService: PrismaService,
    private readonly chainsService: ChainsService,
    private readonly logger: LogsService,
  ) {
    this.status = ServiceStatus.READY;
    this.tradingVariable = {};
  }

  async loadTradingVariables() {
    this.status = ServiceStatus.PROCESS;

    const metadata = await this.prismaService.metadata.findUnique({
      where: {
        key: GNS_V10_TRADING_VARIABLES,
      },
    });

    if (metadata) {
      this.tradingVariable = bigIntSafeJsonParse<
        Record<number, TradingVariable>
      >(metadata.value);
    } else {
      await this.loadTradingVariablesFromContracts();
    }

    this.status = ServiceStatus.READY;
  }

  async loadTradingVariablesFromContracts() {
    this.status = ServiceStatus.PROCESS;

    const allContracts = await this.contractsService.findAll();

    const contracts = allContracts.filter(
      (contract) => contract.platform === Platform.GNS,
    );

    const variables: Record<number, TradingVariable> = {};

    const promises = contracts.map(
      async (contract) =>
        (variables[contract.id] = await this.getTradingVariable(contract)),
    );

    await Promise.allSettled(promises);

    this.tradingVariable = variables;

    await this.prismaService.metadata.upsert({
      where: {
        key: GNS_V10_TRADING_VARIABLES,
      },
      update: {
        value: bigIntSafeJsonStringify(variables),
      },
      create: {
        key: GNS_V10_TRADING_VARIABLES,
        value: bigIntSafeJsonStringify(variables),
      },
    });

    this.status = ServiceStatus.READY;
  }

  async openTrade(payload: OpenTradePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'openTrade',
          args: [payload.args.trade, payload.args.maxSlippageP, zeroAddress],
          account,
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async updateMaxClosingSlippageP(payload: UpdateMaxClosingSlippagePPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'updateMaxClosingSlippageP',
          args: [payload.args.index, payload.args.maxSlippageP],
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async closeTradeMarket(payload: CloseTradeMarketPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'closeTradeMarket',
          args: [payload.args.index, payload.args.expectedPrice],
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async cancelOrderAfterTimeout(payload: CancelOrderAfterTimeoutPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'cancelOrderAfterTimeout',
          args: [payload.args.index],
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async updateTp(payload: UpdateTpPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'updateTp',
          args: [payload.args.index, payload.args.newTp],
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async updateSl(payload: UpdateSlPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'updateSl',
          args: [payload.args.index, payload.args.newSl],
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async updateLeverage(payload: UpdateLeveragePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'updateLeverage',
          args: [payload.args.index, payload.args.newLeverage],
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async increasePositionSize(payload: IncreasePositionSizePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'increasePositionSize',
          args: [
            payload.args.index,
            payload.args.collateralDelta,
            payload.args.leverageDelta,
            payload.args.expectedPrice,
            payload.args.maxSlippageP,
          ],
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async decreasePositionSize(payload: DecreasePositionSizePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'decreasePositionSize',
          args: [
            payload.args.index,
            payload.args.collateralDelta,
            payload.args.leverageDelta,
            payload.args.expectedPrice,
          ],
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async withdrawPositivePnl(payload: WithdrawPositivePnlPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'withdrawPositivePnl',
          args: [payload.args.index, payload.args.amountCollateral],
        });

        await this.chainsService.readWithSemaphore(
          contract.chainId,
          ChainPriority.HIGH,
          async (publicClient) => {
            return await publicClient.waitForTransactionReceipt({
              hash: txHash,
              confirmations: 6,
            });
          },
        );

        return txHash;
      },
    );
  }

  async getPendingOrders(payload: GetPendingOrdersPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.readWithSemaphore(
      contract.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.readContract({
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'getPendingOrders',
          args: [payload.args.address],
        });
      },
    );
  }

  async getTrades(payload: GetTradesPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.readWithSemaphore(
      contract.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.readContract({
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'getTrades',
          args: [payload.args.address],
        });
      },
    );
  }

  async getTrade(payload: GetTradePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.readWithSemaphore(
      contract.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.readContract({
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'getTrade',
          args: [payload.args.address, payload.args.index],
        });
      },
    );
  }

  async getTradingVariable(contract: Contract): Promise<TradingVariable> {
    this.logger.nativeLog({
      severity: 'Info',
      summary: 'GnsService>getTradingVariable',
      details: `Started loading trading variable for contract: ${contract.id}`,
    });

    const refData = await this.chainsService.readWithSemaphore(
      contract.chainId,
      ChainPriority.LOW,
      async (publicClient) => {
        return await publicClient.multicall({
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
      },
    );

    if (refData[0].status === 'failure' || refData[1].status === 'failure') {
      throw new Error('Failed at getting trading variable');
    }

    const pairsData = await this.chainsService.readWithSemaphore(
      contract.chainId,
      ChainPriority.LOW,
      async (publicClient) => {
        return await publicClient.multicall({
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
      },
    );

    const depthData = await this.chainsService.readWithSemaphore(
      contract.chainId,
      ChainPriority.LOW,
      async (publicClient) => {
        return await publicClient.readContract({
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'getPairDepths',
          args: [
            Array.from(Array(Number(refData[0].result)).keys()).map((item) =>
              BigInt(item),
            ),
          ],
        });
      },
    );

    const failedPair = pairsData.find((pair) => pair.status === 'failure');

    if (failedPair) {
      throw new Error('Failed at getting trading variable');
    }

    this.logger.nativeLog({
      severity: 'Info',
      summary: 'GnsService>getTradingVariable',
      details: `Finished loading trading variable for contract: ${contract.id}`,
    });

    return {
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
  }

  async getCollateralPrice(payload: GetCollateralPricePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.readWithSemaphore(
      contract.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.readContract({
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'getCollateralPriceUsd',
          args: [payload.args.collateralIndex],
        });
      },
    );
  }

  async getPairPrice(pairIndex: number): Promise<bigint> {
    const charts = await fetch(
      'https://backend-pricing.eu.gains.trade/charts',
    ).then((res) => res.json());

    return BigInt(Math.floor(charts.closes[pairIndex] * 1e10));
  }

  getPair(contractId: number, pairIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error(
        `Failed at getting trading variable, contractId:${contractId}`,
      );
    }

    return this.tradingVariable[contractId].pairs[pairIndex];
  }

  getPairIndex(contractId: number, pairName: string) {
    if (!this.tradingVariable[contractId]) {
      throw new Error(
        `Failed at getting trading variable, contractId:${contractId}`,
      );
    }

    const pairIndex = this.tradingVariable[contractId].pairs.findIndex(
      (pair) =>
        pair !== undefined &&
        `${pair.from}/${pair.to}`.toLowerCase() === pairName.toLowerCase(),
    );

    return pairIndex;
  }

  getPairs(contractId: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error(
        `Failed at getting trading variable, contractId:${contractId}`,
      );
    }

    return this.tradingVariable[contractId].pairs;
  }

  getPairName(contractId: number, pairIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error(
        `Failed at getting trading variable, contractId:${contractId}`,
      );
    }

    const pair = this.tradingVariable[contractId].pairs[pairIndex];

    return `${pair?.from}/${pair?.to}`;
  }

  getTradePairs(contractIds: number[]): TradePair[] {
    const pairs: TradePair[] = [];

    for (const contractId of contractIds) {
      if (!this.tradingVariable[contractId]) {
        throw new Error(
          `Failed at getting trading variable, contractId:${contractId}`,
        );
      }

      pairs.push(
        ...this.tradingVariable[contractId].pairs.map((pair, index) => ({
          contractId,
          pairIndex: index,
          from: pair?.from || '',
          to: pair?.to || '',
          onePercentDepthAboveUsd:
            pair?.depth.onePercentDepthAboveUsd.toString() || '0',
          onePercentDepthBelowUsd:
            pair?.depth.onePercentDepthBelowUsd.toString() || '0',
        })),
      );
    }

    return pairs;
  }

  getCollateral(contractId: number, collateralIndex: number) {
    if (!this.tradingVariable[contractId]) {
      throw new Error(
        `Failed at getting trading variable, contractId:${contractId}`,
      );
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
      throw new Error(
        `Failed at getting trading variable, contractId:${contractId}`,
      );
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

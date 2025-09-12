import { Injectable } from '@nestjs/common';
import { Address, zeroAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { Platform, Version } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

import { gnsMultiCollatDiamondAbi } from './v10/abi/GNSMultiCollatDiamond';

import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { ChainsService } from 'src/web3/web3/chains.service';
import { LogsService } from 'src/global/logs.service';

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
  Collateral,
  Pair,
} from './v10/types';

import { ChainPriority } from 'src/types';
import { Contract } from 'src/microservices/apiService/modules/contracts/entities/contract.entity';

@Injectable()
export class GnsService {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly chainsService: ChainsService,
    private readonly logger: LogsService,
  ) {
    // this.loadTradingVariablesFromContracts();
  }

  async loadTradingVariablesFromContracts() {
    const allContracts = await this.contractsService.findAll();

    const contracts = allContracts.filter(
      (contract) =>
        contract.platform === Platform.GNS && contract.version === Version.V10,
    );

    const variables: Record<number, TradingVariable> = {};

    const promises = contracts.map(
      async (contract) =>
        (variables[contract.id] = await this.getTradingVariable(contract)),
    );

    await Promise.allSettled(promises);

    const collaterals: Record<number, Collateral[]> = {};
    const pairs: Record<number, (Pair | undefined)[]> = {};

    for (const contract of contracts) {
      collaterals[contract.chainId] = variables[contract.id].collaterals;
      pairs[contract.chainId] = variables[contract.id].pairs;
    }

    const collateralsConfigPath = path.join(
      __dirname,
      'collaterals-config.json',
    );
    const pairsConfigPath = path.join(__dirname, 'pairs-config.json');
    // Ensure the directory exists before writing the file
    const ensureDirectoryExistence = (filePath: string) => {
      const dirname = path.dirname(filePath);
      if (fs.existsSync(dirname)) {
        return true;
      }
      fs.mkdirSync(dirname, { recursive: true });
    };

    // Ensure the directory exists for collateralsConfigPath
    ensureDirectoryExistence(collateralsConfigPath);

    // Ensure the directory exists for pairsConfigPath
    ensureDirectoryExistence(pairsConfigPath);

    console.log('collateralsConfigPath', collateralsConfigPath);
    console.log('pairsConfigPath', pairsConfigPath);

    fs.writeFileSync(
      collateralsConfigPath,
      JSON.stringify(
        collaterals,
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    );
    fs.writeFileSync(
      pairsConfigPath,
      JSON.stringify(
        pairs,
        (_, v) => (typeof v === 'bigint' ? v.toString() : v),
        2,
      ),
    );

    console.log('stored on the config.json');
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
          gas: 2000_000n,
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
          gas: 2000_000n,
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
          gas: 2000_000n,
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
          gas: 2000_000n,
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
          gas: 2000_000n,
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
          gas: 2000_000n,
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
          gas: 2000_000n,
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
          gas: 2000_000n,
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
          gas: 2000_000n,
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
          gas: 2000_000n,
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
          pairIndex: index,
          depth: depthData[index],
        })),
      collaterals: refData[1].result.map((item, index) => ({
        ...item,
        collateralIndex: index + 1,
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
}

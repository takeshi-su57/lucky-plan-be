import { Injectable } from '@nestjs/common';
import { Address, zeroAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

import { gnsMultiCollatDiamondAbi } from './v10/abi/GNSMultiCollatDiamond';

import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { EvmChainsService } from 'src/web3/web3/evm-chains.service';
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
  WithdrawPositivePnlPayload,
} from './v10/types';

import { ChainPriority } from 'src/types';

@Injectable()
export class GnsService {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly chainsService: EvmChainsService,
    private readonly logger: LogsService,
  ) {}

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
          true,
        );

        return txHash;
      },
      true,
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
          true,
        );

        return txHash;
      },
      true,
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
          true,
        );

        return txHash;
      },
      true,
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
          true,
        );

        return txHash;
      },
      true,
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
          true,
        );

        return txHash;
      },
      true,
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
          true,
        );

        return txHash;
      },
      true,
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
          true,
        );

        return txHash;
      },
      true,
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
          true,
        );

        return txHash;
      },
      true,
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
          true,
        );

        return txHash;
      },
      true,
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
          true,
        );

        return txHash;
      },
      true,
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

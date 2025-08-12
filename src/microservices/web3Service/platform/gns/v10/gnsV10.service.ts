import { Injectable } from '@nestjs/common';
import { Address, zeroAddress } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

import { gnsMultiCollatDiamondAbi } from './abi/GNSMultiCollatDiamond';

import { ContractsService } from 'src/microservices/apiService/modules/contracts/contracts.service';
import { ChainsService } from 'src/microservices/web3Service/chains.service';

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
} from './types';
import { LogsService } from 'src/global/logs.service';

@Injectable()
export class GnsV10Service {
  constructor(
    private readonly contractsService: ContractsService,
    private readonly chainsService: ChainsService,
    private readonly logger: LogsService,
  ) {}

  async openTrade(payload: OpenTradePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'openTrade',
          args: [payload.args.trade, payload.args.maxSlippageP, zeroAddress],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async updateMaxClosingSlippageP(payload: UpdateMaxClosingSlippagePPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'updateMaxClosingSlippageP',
          args: [payload.args.index, payload.args.maxSlippageP],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async closeTradeMarket(payload: CloseTradeMarketPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'closeTradeMarket',
          args: [payload.args.index, payload.args.expectedPrice],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async cancelOrderAfterTimeout(payload: CancelOrderAfterTimeoutPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'cancelOrderAfterTimeout',
          args: [payload.args.index],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async updateTp(payload: UpdateTpPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'updateTp',
          args: [payload.args.index, payload.args.newTp],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async updateSl(payload: UpdateSlPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'updateSl',
          args: [payload.args.index, payload.args.newSl],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async updateLeverage(payload: UpdateLeveragePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'updateLeverage',
          args: [payload.args.index, payload.args.newLeverage],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async increasePositionSize(payload: IncreasePositionSizePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
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
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async decreasePositionSize(payload: DecreasePositionSizePayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
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
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async withdrawPositivePnl(payload: WithdrawPositivePnlPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      contract.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: contract.address as Address,
          abi: gnsMultiCollatDiamondAbi,
          functionName: 'withdrawPositivePnl',
          args: [payload.args.index, payload.args.amountCollateral],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      contract.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async getPendingOrders(payload: GetPendingOrdersPayload) {
    const contract = await this.contractsService.findOne(payload.contractId);

    return await this.chainsService.readWithSemaphore(
      contract.chainId,
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

  async getTradingVariable(contractId: number): Promise<TradingVariable> {
    this.logger.nativeLog({
      severity: 'Info',
      summary: 'GnsV10Service>getTradingVariable',
      details: `Started loading trading variable for contract: ${contractId}`,
    });

    const contract = await this.contractsService.findOne(contractId);

    const refData = await this.chainsService.readWithSemaphore(
      contract.chainId,
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
}

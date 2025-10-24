import { Injectable } from '@nestjs/common';
import { Block, erc20Abi, GetBlockErrorType, GetLogsReturnType } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

import { getReadableError } from 'src/utils';
import { LogsService } from 'src/global/logs.service';

import { EvmChainsService } from './evm-chains.service';
import {
  Erc20TransferPayload,
  Erc20BalancePayload,
  Erc20AllowancePayload,
  Erc20ApprovePayload,
  EstimateGasPayload,
  NativeTransferPayload,
  NativeBalancePayload,
  WaitForTransactionReceiptPayload,
  GetBlockPayload,
  GetLogsPayload,
  EstimateFeesPerGasPayload,
  GetBlockNumberPayload,
} from './types';
import { ChainPriority } from 'src/types';

@Injectable()
export class EvmAdapterService {
  constructor(
    private readonly chainsService: EvmChainsService,
    private readonly logger: LogsService,
  ) {}

  async erc20Transfer(payload: Erc20TransferPayload) {
    return await this.chainsService.writeWithMutex(
      payload.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: payload.erc20ContractAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [payload.toAddress, payload.amount],
        });

        await this.chainsService.readWithSemaphore(
          payload.chainId,
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

  async erc20Allowance(payload: Erc20AllowancePayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.readContract({
          address: payload.erc20ContractAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [payload.address, payload.spender],
        });
      },
    );
  }

  async erc20Approve(payload: Erc20ApprovePayload) {
    return await this.chainsService.writeWithMutex(
      payload.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const account = mnemonicToAccount(payload.mnemonic, {
          accountIndex: payload.accountIndex,
        });

        const txHash = await wallet.writeContract({
          chain: wallet.chain,
          account,
          address: payload.erc20ContractAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [payload.spender, payload.amount],
        });

        await this.chainsService.readWithSemaphore(
          payload.chainId,
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

  async nativeTransfer(payload: NativeTransferPayload) {
    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    return await this.chainsService.writeWithMutex(
      payload.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        const txHash = await wallet.sendTransaction({
          account,
          to: payload.toAddress,
          value: payload.amount,
          chain: wallet.chain,
        });

        await this.chainsService.readWithSemaphore(
          payload.chainId,
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

  async erc20Balance(payload: Erc20BalancePayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.readContract({
          address: payload.erc20ContractAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [payload.address],
        });
      },
    );
  }

  async nativeBalance(payload: NativeBalancePayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.getBalance({ address: payload.address });
      },
    );
  }

  async waitForTransactionReceipt(payload: WaitForTransactionReceiptPayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.waitForTransactionReceipt({
          hash: payload.hash,
          confirmations: payload.confirmations,
        });
      },
    );
  }

  async estimateGas(payload: EstimateGasPayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.estimateGas({
          account: payload.accountAddress,
          to: payload.toAddress,
          value: payload.amount,
        });
      },
    );
  }

  async estimateFeesPerGas(payload: EstimateFeesPerGasPayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.estimateFeesPerGas();
      },
    );
  }

  async getBlockNumber(payload: GetBlockNumberPayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.getBlockNumber();
      },
    );
  }

  async getBlock(payload: GetBlockPayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.getBlock({
          blockNumber: payload.blockNumber,
        });
      },
    );
  }

  async getValidBlock(payload: GetBlockPayload): Promise<Block> {
    try {
      return await this.chainsService.readWithSemaphore(
        payload.chainId,
        payload.priority,
        async (publicClient) => {
          return await publicClient.getBlock({
            blockNumber: payload.blockNumber,
          });
        },
      );
    } catch (err) {
      const error = err as GetBlockErrorType;

      if (error.name === 'BlockNotFoundError') {
        return await this.getValidBlock({
          ...payload,
          blockNumber: payload.blockNumber + 1n,
        });
      }

      throw err;
    }
  }

  async getLogs(payload: GetLogsPayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      payload.priority,
      async (publicClient) => {
        return await publicClient.getLogs({
          fromBlock: payload.fromBlock,
          toBlock: payload.toBlock,
          address: payload.address,
          events: payload.events,
        });
      },
    );
  }

  async getFrequentLogs(
    chainId: number,
    address: `0x${string}`,
    fromBlock: bigint,
    toBlock: bigint,
  ): Promise<
    GetLogsReturnType<undefined, undefined, undefined, bigint, bigint>
  > {
    const connection = await this.chainsService.getAvailableConnection(chainId);

    try {
      const result = await connection.connection.getLogs({
        fromBlock,
        toBlock,
        address,
      });

      this.chainsService.unlockConnection(chainId, connection.id, 5_000);

      return result;
    } catch (err) {
      this.logger.log({
        severity: 'Critical',
        summary: 'Error getting signatures for address',
        details: getReadableError(err),
      });

      this.chainsService.unlockConnection(chainId, connection.id, 120_000);

      return await this.getFrequentLogs(chainId, address, fromBlock, toBlock);
    }
  }
}

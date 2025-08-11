import { Injectable } from '@nestjs/common';
import { erc20Abi } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';

import { ChainsService } from './chains.service';
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
} from './types';

@Injectable()
export class Web3Service {
  constructor(private readonly chainsService: ChainsService) {}

  async erc20Transfer(payload: Erc20TransferPayload) {
    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      payload.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: payload.erc20ContractAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [payload.toAddress, payload.amount],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      payload.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
      },
    );
  }

  async erc20Allowance(payload: Erc20AllowancePayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
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
    const account = mnemonicToAccount(payload.mnemonic, {
      accountIndex: payload.accountIndex,
    });

    const { request } = await this.chainsService.readWithSemaphore(
      payload.chainId,
      async (publicClient) => {
        return await publicClient.simulateContract({
          account,
          address: payload.erc20ContractAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [payload.spender, payload.amount],
        });
      },
    );

    return await this.chainsService.writeWithMutex(
      payload.chainId,
      payload.mnemonic,
      payload.accountIndex,
      async (wallet) => {
        return await wallet.writeContract(request);
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
        return await wallet.sendTransaction({
          account,
          to: payload.toAddress,
          value: payload.amount,
          chain: wallet.chain,
        });
      },
    );
  }

  async erc20Balance(payload: Erc20BalancePayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
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
      async (publicClient) => {
        return await publicClient.getBalance({ address: payload.address });
      },
    );
  }

  async waitForTransactionReceipt(payload: WaitForTransactionReceiptPayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
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
      async (publicClient) => {
        return await publicClient.estimateGas({
          account: payload.accountAddress,
          to: payload.toAddress,
          value: payload.amount,
        });
      },
    );
  }

  async estimateFeesPerGas(chainId: number) {
    return await this.chainsService.readWithSemaphore(
      chainId,
      async (publicClient) => {
        return await publicClient.estimateFeesPerGas();
      },
    );
  }

  async getBlockNumber(chainId: number) {
    return await this.chainsService.readWithSemaphore(
      chainId,
      async (publicClient) => {
        return await publicClient.getBlockNumber();
      },
    );
  }

  async getBlock(payload: GetBlockPayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      async (publicClient) => {
        return await publicClient.getBlock({
          blockNumber: payload.blockNumber,
        });
      },
    );
  }

  async getLogs(payload: GetLogsPayload) {
    return await this.chainsService.readWithSemaphore(
      payload.chainId,
      async (publicClient) => {
        return await publicClient.getLogs({
          fromBlock: payload.fromBlock,
          toBlock: payload.toBlock,
          address: payload.address,
        });
      },
    );
  }
}

import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { bigIntSafeJsonStringify, bigIntSafeJsonParse } from 'src/utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import {
  Erc20TransferPayload,
  Erc20BalancePayload,
  NativeTransferPayload,
  NativeBalancePayload,
  EstimateGasPayload,
  WaitForTransactionReceiptPayload,
  Erc20AllowancePayload,
  Erc20ApprovePayload,
  GetBlockPayload,
  GetLogsPayload,
  EstimateFeesPerGasPayload,
  GetBlockNumberPayload,
} from 'src/microservices/web3Service/types';
import { Block, Log, TransactionReceipt } from 'viem';

@Injectable()
export class Web3Service {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
  ) {}

  async erc20Transfer(data: Erc20TransferPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.Erc20Transfer, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async erc20Balance(data: Erc20BalancePayload) {
    return await new Promise<bigint>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.Erc20Balance, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(bigIntSafeJsonParse<bigint>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async erc20Allowance(data: Erc20AllowancePayload) {
    return await new Promise<bigint>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.Erc20Allowance, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(bigIntSafeJsonParse<bigint>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async erc20Approve(data: Erc20ApprovePayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.Erc20Approve, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async nativeTransfer(data: NativeTransferPayload) {
    return await new Promise<`0x${string}`>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.NativeTransfer, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(data),
          error: (err) => reject(err),
        });
    });
  }

  async nativeBalance(data: NativeBalancePayload) {
    return await new Promise<bigint>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.NativeBalance, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(bigIntSafeJsonParse<bigint>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async waitForTransactionReceipt(data: WaitForTransactionReceiptPayload) {
    return await new Promise<TransactionReceipt>((resolve, reject) => {
      this.redisClient
        .send(
          PATTERNS.Web3.WaitForTransactionReceipt,
          bigIntSafeJsonStringify(data),
        )
        .subscribe({
          next: (data) =>
            resolve(bigIntSafeJsonParse<TransactionReceipt>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async estimateGas(data: EstimateGasPayload) {
    return await new Promise<bigint>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.EstimateGas, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(bigIntSafeJsonParse<bigint>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async estimateFeesPerGas(data: EstimateFeesPerGasPayload) {
    return await new Promise<{ maxFeePerGas: bigint }>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.EstimateFeesPerGas, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) =>
            resolve(bigIntSafeJsonParse<{ maxFeePerGas: bigint }>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async getBlockNumber(data: GetBlockNumberPayload) {
    return await new Promise<bigint>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.GetBlockNumber, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(bigIntSafeJsonParse<bigint>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async getBlock(data: GetBlockPayload) {
    return await new Promise<Block>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.GetBlock, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(bigIntSafeJsonParse<Block>(data)),
          error: (err) => reject(err),
        });
    });
  }

  async getLogs(data: GetLogsPayload) {
    return await new Promise<Log[]>((resolve, reject) => {
      this.redisClient
        .send(PATTERNS.Web3.GetLogs, bigIntSafeJsonStringify(data))
        .subscribe({
          next: (data) => resolve(bigIntSafeJsonParse<Log[]>(data)),
          error: (err) => reject(err),
        });
    });
  }
}

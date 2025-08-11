import { Controller, Inject } from '@nestjs/common';
import {
  ClientProxy,
  EventPattern,
  MessagePattern,
  Payload,
} from '@nestjs/microservices';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import {
  Erc20TransferPayload,
  Erc20BalancePayload,
  Erc20AllowancePayload,
  Erc20ApprovePayload,
  NativeTransferPayload,
  WaitForTransactionReceiptPayload,
  EstimateGasPayload,
  NativeBalancePayload,
  GetBlockPayload,
  GetLogsPayload,
} from './types';
import { bigIntSafeJsonParse, bigIntSafeJsonStringify } from 'src/utils';

import { Web3Service } from './web3.service';

@Controller()
export class Web3Controller {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly web3Service: Web3Service,
  ) {
    this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.WEB3_SERVICE,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.LEADERBOARD_SERVICE,
      status: ServiceStatus.KILLED,
    });

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
  }

  @MessagePattern(PATTERNS.Web3.Erc20Transfer)
  async erc20Transfer(@Payload() payload: string) {
    return await this.web3Service.erc20Transfer(
      bigIntSafeJsonParse<Erc20TransferPayload>(payload),
    );
  }

  @MessagePattern(PATTERNS.Web3.Erc20Balance)
  async erc20Balance(@Payload() payload: string) {
    return bigIntSafeJsonStringify(
      await this.web3Service.erc20Balance(
        bigIntSafeJsonParse<Erc20BalancePayload>(payload),
      ),
    );
  }

  @MessagePattern(PATTERNS.Web3.Erc20Allowance)
  async erc20Allowance(@Payload() payload: string) {
    return bigIntSafeJsonStringify(
      await this.web3Service.erc20Allowance(
        bigIntSafeJsonParse<Erc20AllowancePayload>(payload),
      ),
    );
  }

  @MessagePattern(PATTERNS.Web3.Erc20Approve)
  async erc20Approve(@Payload() payload: string) {
    return await this.web3Service.erc20Approve(
      bigIntSafeJsonParse<Erc20ApprovePayload>(payload),
    );
  }

  @MessagePattern(PATTERNS.Web3.NativeTransfer)
  async nativeTransfer(@Payload() payload: string) {
    return await this.web3Service.nativeTransfer(
      bigIntSafeJsonParse<NativeTransferPayload>(payload),
    );
  }

  @MessagePattern(PATTERNS.Web3.NativeBalance)
  async nativeBalance(@Payload() payload: string) {
    return bigIntSafeJsonStringify(
      await this.web3Service.nativeBalance(
        bigIntSafeJsonParse<NativeBalancePayload>(payload),
      ),
    );
  }

  @MessagePattern(PATTERNS.Web3.WaitForTransactionReceipt)
  async waitForTransactionReceipt(@Payload() payload: string) {
    return bigIntSafeJsonStringify(
      await this.web3Service.waitForTransactionReceipt(
        bigIntSafeJsonParse<WaitForTransactionReceiptPayload>(payload),
      ),
    );
  }

  @MessagePattern(PATTERNS.Web3.EstimateGas)
  async estimateGas(@Payload() payload: string) {
    return bigIntSafeJsonStringify(
      await this.web3Service.estimateGas(
        bigIntSafeJsonParse<EstimateGasPayload>(payload),
      ),
    );
  }

  @MessagePattern(PATTERNS.Web3.EstimateFeesPerGas)
  async estimateFeesPerGas(@Payload() chainId: number) {
    return bigIntSafeJsonStringify(
      await this.web3Service.estimateFeesPerGas(chainId),
    );
  }

  @MessagePattern(PATTERNS.Web3.GetBlockNumber)
  async getBlockNumber(@Payload() chainId: number) {
    return bigIntSafeJsonStringify(
      await this.web3Service.getBlockNumber(chainId),
    );
  }

  @MessagePattern(PATTERNS.Web3.GetBlock)
  async getBlock(@Payload() payload: string) {
    return bigIntSafeJsonStringify(
      await this.web3Service.getBlock(
        bigIntSafeJsonParse<GetBlockPayload>(payload),
      ),
    );
  }

  @MessagePattern(PATTERNS.Web3.GetLogs)
  async getLogs(@Payload() payload: string) {
    return bigIntSafeJsonStringify(
      await this.web3Service.getLogs(
        bigIntSafeJsonParse<GetLogsPayload>(payload),
      ),
    );
  }
}

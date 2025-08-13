import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
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
  EstimateFeesPerGasPayload,
  GetBlockNumberPayload,
} from './types';
import { bigIntSafeJsonParse, bigIntSafeJsonStringify } from 'src/utils';

import { Web3Service } from './web3.service';
import { LogsService } from 'src/global/logs.service';
import { delay } from 'src/utils';

@Controller()
export class Web3Controller implements OnApplicationBootstrap {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly web3Service: Web3Service,
    private readonly logger: LogsService,
  ) {}

  async onApplicationBootstrap() {
    await delay(60_000);

    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.WEB3_SERVICE,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    await this.logger.nativeLog({
      severity: 'Info',
      summary: 'Leaderboard service killProcess',
      details: 'received kill process event',
    });

    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.WEB3_SERVICE,
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
  async estimateFeesPerGas(@Payload() payload: string) {
    return bigIntSafeJsonStringify(
      await this.web3Service.estimateFeesPerGas(
        bigIntSafeJsonParse<EstimateFeesPerGasPayload>(payload),
      ),
    );
  }

  @MessagePattern(PATTERNS.Web3.GetBlockNumber)
  async getBlockNumber(@Payload() payload: string) {
    return bigIntSafeJsonStringify(
      await this.web3Service.getBlockNumber(
        bigIntSafeJsonParse<GetBlockNumberPayload>(payload),
      ),
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

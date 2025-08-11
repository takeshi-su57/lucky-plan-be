import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { ClientProxy, EventPattern } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { delay, getReadableError } from 'src/utils';

import { GnsV10Service } from 'src/global/gnsV10.service';
import { BotsService } from 'src/microservices/apiService/modules/bots/bots.service';
import { ContractMonitorService } from './contract-monitor.service';
import { TaskExecutorService } from '../apiService/modules/task-executor/task-executor.service';
import { LogsService } from 'src/global/logs.service';

@Controller()
export class TradingController implements OnApplicationBootstrap {
  private isReceivedKillProcess = false;
  private isAppBootstrapped = false;

  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly contractMonitorService: ContractMonitorService,
    private readonly gnsV10Service: GnsV10Service,
    private readonly botsService: BotsService,
    private readonly taskExecutorService: TaskExecutorService,
    private readonly logger: LogsService,
  ) {
    this.isReceivedKillProcess = false;
  }

  onApplicationBootstrap() {
    this.isAppBootstrapped = true;
  }

  private async reloadTradingVariables() {
    this.gnsV10Service.status = ServiceStatus.PAUSED;

    const promise = new Promise((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, 20_000),
    );

    await promise;

    await this.gnsV10Service.loadTradingVariables();

    await this.logger.nativeLog({
      severity: 'Info',
      summary: 'trading variables reloaded',
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    this.isReceivedKillProcess = true;

    this.logger.nativeLog({
      severity: 'Info',
      summary: 'Trading service killProcess',
      details: 'received kill process event',
    });

    while (true) {
      await delay(1000);

      if (
        this.contractMonitorService.status !== ServiceStatus.READY ||
        this.botsService.status !== ServiceStatus.READY
      ) {
        continue;
      }

      break;
    }

    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.TRADING_SERVICE,
      status: ServiceStatus.KILLED,
    });

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async executeCronForBotMonitor() {
    if (
      this.isReceivedKillProcess ||
      this.gnsV10Service.status !== ServiceStatus.READY ||
      this.contractMonitorService.status !== ServiceStatus.READY ||
      this.taskExecutorService.status !== ServiceStatus.READY
    ) {
      return;
    }

    await this.contractMonitorService.checkContractsForBots();
    await this.taskExecutorService.performAvailableTasks();
    await this.taskExecutorService.handleFailedTasks();
  }

  @Cron(CronExpression.EVERY_3_HOURS)
  async executeCronForReloadTradingVariables() {
    if (
      this.isReceivedKillProcess ||
      this.gnsV10Service.status !== ServiceStatus.READY
    ) {
      return;
    }

    try {
      await this.reloadTradingVariables();
    } catch (err) {
      this.logger.nativeLog({
        severity: 'Error',
        summary: 'trading.controller>executeCronForReloadTradingVariables',
        details: getReadableError(err),
      });
    }
  }

  @EventPattern(PATTERNS.ProcessStatus)
  async updateProcessStatus(data: { service: string; status: ServiceStatus }) {
    if (
      data.service === SERVICE_NAMES.WEB3_SERVICE &&
      data.status === ServiceStatus.READY
    ) {
      await this.logger.nativeLog({
        severity: 'Info',
        summary: 'trading.controller>updateProcessStatus',
        details: `web3 service is ready, reloading trading variables`,
      });

      while (true) {
        await delay(1000);

        if (!this.isAppBootstrapped) {
          continue;
        }

        await this.reloadTradingVariables();

        await this.client.emit(PATTERNS.ProcessStatus, {
          service: SERVICE_NAMES.TRADING_SERVICE,
          status: ServiceStatus.READY,
        });

        break;
      }
    }
  }
}

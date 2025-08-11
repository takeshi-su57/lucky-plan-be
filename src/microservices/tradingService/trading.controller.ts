import { Controller, Inject } from '@nestjs/common';
import { ClientProxy, EventPattern } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { delay } from 'src/utils';

import { GnsV10Service } from 'src/global/gnsV10.service';
import { BotsService } from 'src/microservices/apiService/modules/bots/bots.service';
import { ContractMonitorService } from './contract-monitor.service';
import { TaskExecutorService } from '../apiService/modules/task-executor/task-executor.service';

@Controller()
export class TradingController {
  private stopForTradingVariableLoading = false;
  private isReceivedKillProcess = false;

  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly contractMonitorService: ContractMonitorService,
    private readonly gnsV10Service: GnsV10Service,
    private readonly botsService: BotsService,
    private readonly taskExecutorService: TaskExecutorService,
  ) {
    this.stopForTradingVariableLoading = false;
    this.isReceivedKillProcess = false;

    this.reloadTradingVariables().then(() => {
      this.client.emit(PATTERNS.ProcessStatus, {
        service: SERVICE_NAMES.TRADING_SERVICE,
        status: ServiceStatus.READY,
      });
    });
  }

  private async reloadTradingVariables() {
    if (this.gnsV10Service.status !== 'ready') {
      return;
    }

    this.stopForTradingVariableLoading = true;

    const promise = new Promise((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, 20_000),
    );

    await promise;

    this.stopForTradingVariableLoading = false;

    await this.gnsV10Service.loadTradingVariables();

    console.log('trading variables reloaded');
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    this.isReceivedKillProcess = true;

    while (true) {
      await delay(1000);

      if (
        this.gnsV10Service.status !== 'ready' ||
        this.contractMonitorService.status !== 'ready' ||
        this.botsService.status !== 'ready'
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
      this.stopForTradingVariableLoading ||
      this.isReceivedKillProcess ||
      this.gnsV10Service.status !== 'ready'
    ) {
      return;
    }

    if (
      this.contractMonitorService.status === 'ready' &&
      this.taskExecutorService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContractsForBots();
      await this.taskExecutorService.performAvailableTasks();
      await this.taskExecutorService.handleFailedTasks();
    }
  }
}

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
  private isReceivedKillProcess = false;

  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly contractMonitorService: ContractMonitorService,
    private readonly gnsV10Service: GnsV10Service,
    private readonly botsService: BotsService,
    private readonly taskExecutorService: TaskExecutorService,
  ) {
    this.isReceivedKillProcess = false;
  }

  private async reloadTradingVariables() {
    if (this.gnsV10Service.status !== 'ready') {
      return;
    }

    this.gnsV10Service.status = ServiceStatus.PAUSED;

    const promise = new Promise((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, 20_000),
    );

    await promise;

    await this.gnsV10Service.loadTradingVariables();

    console.log('trading variables reloaded');
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    this.isReceivedKillProcess = true;

    while (true) {
      await delay(1000);

      if (
        this.gnsV10Service.status !== ServiceStatus.READY ||
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
      this.gnsV10Service.status !== ServiceStatus.READY
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

  @EventPattern(PATTERNS.ProcessStatus)
  updateProcessStatus(data: { service: string; status: ServiceStatus }) {
    if (data.service === SERVICE_NAMES.WEB3_SERVICE) {
      this.gnsV10Service.status = data.status;

      if (data.status === ServiceStatus.READY) {
        this.reloadTradingVariables().then(() =>
          this.client.emit(PATTERNS.ProcessStatus, {
            service: SERVICE_NAMES.TRADING_SERVICE,
            status: ServiceStatus.READY,
          }),
        );
      }
    }
  }
}

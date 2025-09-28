import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { BotsService } from 'src/microservices/apiService/modules/bots/bots.service';
import { TradingService } from './trading.service';
import { TaskExecutorService } from '../apiService/modules/task-executor/task-executor.service';
import { LogsService } from 'src/global/logs.service';
import { PlansService } from '../apiService/modules/plans/plans.service';

@Controller()
export class TradingController implements OnApplicationBootstrap {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly tradingService: TradingService,
    private readonly botsService: BotsService,
    private readonly plansService: PlansService,
    private readonly taskExecutorService: TaskExecutorService,
    private readonly logger: LogsService,
  ) {}

  async onApplicationBootstrap() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.TRADING_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.AskProcessStatus)
  async askProcessStatus() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.TRADING_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess(@Payload() payload?: { service?: string }) {
    if (payload?.service && payload.service !== SERVICE_NAMES.TRADING_SERVICE) {
      return;
    }

    this.tradingService.isReceivedKillProcess = true;

    this.logger.nativeLog({
      severity: 'Info',
      summary: 'Trading service killProcess',
      details: 'received kill process event',
    });

    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.TRADING_SERVICE,
      pid: process.pid,
      status: ServiceStatus.KILLED,
    });

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
  }

  @Cron(CronExpression.EVERY_SECOND)
  async executeCronForBotMonitor() {
    if (
      this.tradingService.isReceivedKillProcess ||
      this.tradingService.status !== ServiceStatus.READY ||
      this.taskExecutorService.status !== ServiceStatus.READY
    ) {
      return;
    }

    await this.tradingService.checkContractsForBots();
    await this.taskExecutorService.performAvailableTasks();
    await this.taskExecutorService.handleFailedTasks();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkAndUpdateAllBots() {
    if (this.tradingService.isReceivedKillProcess) {
      return;
    }

    if (this.botsService.status === ServiceStatus.READY) {
      await this.botsService.checkAndUpdateAllBots();
    }

    if (this.plansService.status === ServiceStatus.READY) {
      await this.plansService.checkAndUpdateAllPlans();
    }
  }
}

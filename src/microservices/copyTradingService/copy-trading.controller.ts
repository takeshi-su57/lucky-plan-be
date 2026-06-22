import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { BotsService } from 'src/microservices/apiService/modules/bots/bots.service';
import { LogsService } from 'src/global/logs.service';
import { PlansService } from '../apiService/modules/plans/plans.service';
import { SLTPService } from '../apiService/modules/sltp/sltp.service';
import { CopyTradingService } from './copy-trading.service';

@Controller()
export class CopyTradingController implements OnApplicationBootstrap {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly botsService: BotsService,
    private readonly plansService: PlansService,
    private readonly sltpService: SLTPService,
    private readonly copyTradingService: CopyTradingService,
    private readonly logger: LogsService,
  ) {}

  async onApplicationBootstrap() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.COPY_TRADING_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.AskProcessStatus)
  async askProcessStatus() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.COPY_TRADING_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess(@Payload() payload?: { service?: string }) {
    if (
      payload?.service &&
      payload.service !== SERVICE_NAMES.COPY_TRADING_SERVICE
    ) {
      return;
    }

    this.logger.nativeLog({
      severity: 'Info',
      summary: 'Trading service killProcess',
      details: 'received kill process event',
    });

    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.COPY_TRADING_SERVICE,
      pid: process.pid,
      status: ServiceStatus.KILLED,
    });

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async executeCronForBotMonitor() {
    if (this.copyTradingService.status !== ServiceStatus.READY) {
      return;
    }

    await this.copyTradingService.run();
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkAndUpdateAllBots() {
    if (this.botsService.status === ServiceStatus.READY) {
      await this.botsService.checkAndUpdateAllBots();
    }

    if (this.plansService.status === ServiceStatus.READY) {
      await this.plansService.checkAndUpdateAllPlans();
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async checkAndUpdateAllSLTPs() {
    await this.sltpService.checkAllSLTPs();
  }
}

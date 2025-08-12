import { Controller } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventPattern } from '@nestjs/microservices';

import { ServiceStatus } from 'src/types';

import { PATTERNS } from 'src/utils/constants';

import { LogsService } from 'src/global/logs.service';
import { ApiService } from './api.service';
import { GnsV10Service } from 'src/global/gnsV10.service';
import { BotsService } from './modules/bots/bots.service';
import { PlansService } from './modules/plans/plans.service';
import { AutoPlansService } from './modules/plans/autoplans.service';
import { getReadableError } from 'src/utils';

@Controller()
export class ApiController {
  constructor(
    private readonly apiService: ApiService,
    private readonly logger: LogsService,
    private readonly autoPlansService: AutoPlansService,
    private readonly gnsV10Service: GnsV10Service,
    private readonly botsService: BotsService,
    private readonly plansService: PlansService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async checkAndUpdateAllBots() {
    if (
      this.gnsV10Service.status !== ServiceStatus.READY ||
      this.apiService.isPaused
    ) {
      return;
    }

    if (this.botsService.status === ServiceStatus.READY) {
      await this.botsService.checkAndUpdateAllBots();
    }

    if (this.plansService.status === ServiceStatus.READY) {
      await this.plansService.checkAndUpdateAllPlans();
    }
  }

  @Cron(CronExpression.EVERY_3_HOURS)
  async executeCronForAutoPlans() {
    if (
      this.apiService.isPaused ||
      this.autoPlansService.status !== ServiceStatus.READY
    ) {
      return;
    }

    try {
      await this.gnsV10Service.loadTradingVariables();

      await this.autoPlansService.createAutoPlans();
    } catch (err) {
      this.logger.nativeLog({
        severity: 'Error',
        summary: 'api.controller>executeCronForAutoPlans',
        details: getReadableError(err),
      });
    }
  }

  @EventPattern(PATTERNS.ProcessStatus)
  updateProcessStatus(data: { service: string; status: ServiceStatus }) {
    this.logger.nativeLog({
      severity: 'Info',
      summary: 'UPDATE_PROCESS_STATUS',
      details: JSON.stringify(data),
    });

    this.apiService.updateProcessStatus(data.service, data.status);
  }
}

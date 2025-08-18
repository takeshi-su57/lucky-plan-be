import { Controller } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventPattern } from '@nestjs/microservices';

import { ServiceStatus } from 'src/types';

import { PATTERNS } from 'src/utils/constants';

import { LogsService } from 'src/global/logs.service';
import { ApiService } from './api.service';
import { getReadableError } from 'src/utils';

@Controller()
export class ApiController {
  constructor(
    private readonly apiService: ApiService,
    private readonly logger: LogsService,
  ) {}

  @Cron(CronExpression.EVERY_3_HOURS)
  async executeCronForReloadTradingVariables() {
    if (this.apiService.isPaused) {
      return;
    }

    try {
      await this.apiService.reloadTradingVariables();
    } catch (err) {
      this.logger.nativeLog({
        severity: 'Error',
        summary: 'api.controller>executeCronForReloadTradingVariables',
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

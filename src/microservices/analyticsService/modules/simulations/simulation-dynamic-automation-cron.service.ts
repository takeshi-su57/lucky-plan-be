import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { LogsService } from 'src/global/logs.service';
import { getReadableError } from 'src/utils';
import { SimulationDynamicAutoSchedulerService } from './simulation-dynamic-auto-scheduler.service';

@Injectable()
export class SimulationDynamicAutomationCronService {
  private isProcessing = false;

  constructor(
    private readonly scheduler: SimulationDynamicAutoSchedulerService,
    private readonly logger: LogsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async processDynamicPlans() {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      await this.scheduler.processAvailableSimulations();
    } catch (error) {
      await this.logger.nativeLog({
        severity: 'Error',
        summary:
          'analytics.simulationDynamicAutomationCron>processDynamicPlans',
        details: getReadableError(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }
}

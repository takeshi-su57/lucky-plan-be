import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { LogsService } from 'src/global/logs.service';
import { getReadableError } from 'src/utils';
import { SimulationDynamicAutoSchedulerService } from './simulation-dynamic-auto-scheduler.service';

@Injectable()
export class SimulationDynamicAutomationCronService {
  private isMaintainingQueue = false;
  private isDispatchingFinalizers = false;

  constructor(
    private readonly scheduler: SimulationDynamicAutoSchedulerService,
    private readonly logger: LogsService,
  ) {}

  @Cron(CronExpression.EVERY_10_SECONDS)
  async maintainDynamicPlanQueue() {
    if (this.isMaintainingQueue) return;
    this.isMaintainingQueue = true;
    try {
      await this.scheduler.processQueueMaintenance();
    } catch (error) {
      await this.logger.nativeLog({
        severity: 'Error',
        summary:
          'analytics.simulationDynamicAutomationCron>maintainDynamicPlanQueue',
        details: getReadableError(error),
      });
    } finally {
      this.isMaintainingQueue = false;
    }
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async dispatchDynamicPlanFinalizers() {
    if (this.isDispatchingFinalizers) return;
    this.isDispatchingFinalizers = true;
    try {
      await this.scheduler.processFinalizations();
    } catch (error) {
      await this.logger.nativeLog({
        severity: 'Error',
        summary:
          'analytics.simulationDynamicAutomationCron>dispatchDynamicPlanFinalizers',
        details: getReadableError(error),
      });
    } finally {
      this.isDispatchingFinalizers = false;
    }
  }
}

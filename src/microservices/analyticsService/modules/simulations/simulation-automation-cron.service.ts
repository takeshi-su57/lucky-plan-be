import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { LogsService } from 'src/global/logs.service';
import { getReadableError } from 'src/utils';
import { AnalyticsSimulationsService } from './analytics-simulations.service';

@Injectable()
export class SimulationAutomationCronService {
  private isProcessing = false;

  constructor(
    private readonly simulationsService: AnalyticsSimulationsService,
    private readonly logger: LogsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processQueuedSimulation() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      await this.simulationsService.processNextQueuedAutoSimulation();
    } catch (error) {
      await this.logger.nativeLog({
        severity: 'Error',
        summary: 'analytics.simulationAutomationCron>processQueuedSimulation',
        details: getReadableError(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }
}

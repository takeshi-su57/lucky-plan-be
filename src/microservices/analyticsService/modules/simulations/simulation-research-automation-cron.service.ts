import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { LogsService } from 'src/global/logs.service';
import { getReadableError } from 'src/utils';
import { AnalyticsSimulationResearchService } from './analytics-simulation-research.service';

@Injectable()
export class SimulationResearchAutomationCronService {
  private isProcessing = false;

  constructor(
    private readonly simulationResearchService: AnalyticsSimulationResearchService,
    private readonly logger: LogsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processAutomaticResearch() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      await this.simulationResearchService.processNextAutomaticResearch();
    } catch (error) {
      await this.logger.nativeLog({
        severity: 'Error',
        summary:
          'analytics.simulationResearchAutomationCron>processAutomaticResearch',
        details: getReadableError(error),
      });
    } finally {
      this.isProcessing = false;
    }
  }
}

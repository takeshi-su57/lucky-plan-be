import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { LogsService } from 'src/global/logs.service';
import { getReadableError } from 'src/utils';
import { SimulationDynamicAutoSchedulerService } from './simulation-dynamic-auto-scheduler.service';

@Injectable()
export class SimulationDynamicAutomationCronService {
  private isRegisteringEvaluations = false;
  private isHandlingResolvedEvaluations = false;
  private isFinalizingMaterializedSimulation = false;

  constructor(
    private readonly scheduler: SimulationDynamicAutoSchedulerService,
    private readonly logger: LogsService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async registerLeaderEvaluationTasks() {
    if (this.isRegisteringEvaluations) return;
    this.isRegisteringEvaluations = true;
    try {
      await this.scheduler.registerLeaderEvaluationTasks();
    } catch (error) {
      await this.logger.nativeLog({
        severity: 'Error',
        summary:
          'analytics.simulationDynamicAutomationCron>registerLeaderEvaluationTasks',
        details: getReadableError(error),
      });
    } finally {
      this.isRegisteringEvaluations = false;
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async handleResolvedEvaluationTasks() {
    if (this.isHandlingResolvedEvaluations) return;
    this.isHandlingResolvedEvaluations = true;
    try {
      await this.scheduler.handleResolvedEvaluationTasks();
    } catch (error) {
      await this.logger.nativeLog({
        severity: 'Error',
        summary:
          'analytics.simulationDynamicAutomationCron>handleResolvedEvaluationTasks',
        details: getReadableError(error),
      });
    } finally {
      this.isHandlingResolvedEvaluations = false;
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async finalizeMaterializedSimulation() {
    if (this.isFinalizingMaterializedSimulation) return;
    this.isFinalizingMaterializedSimulation = true;
    try {
      await this.scheduler.finalizeMaterializedSimulations();
    } catch (error) {
      await this.logger.nativeLog({
        severity: 'Error',
        summary:
          'analytics.simulationDynamicAutomationCron>finalizeMaterializedSimulation',
        details: getReadableError(error),
      });
    } finally {
      this.isFinalizingMaterializedSimulation = false;
    }
  }
}

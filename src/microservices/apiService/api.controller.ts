import { Controller } from '@nestjs/common';
import { EventPattern } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LogSeverity } from '@prisma/client';

import { ServiceStatus } from 'src/types';

import { PATTERNS } from 'src/utils/constants';

import { LogsService } from 'src/loggers/logs.service';
import { ApiService } from './api.service';
import { SecurityService } from 'src/global/security.service';
import { TradingVariableService } from 'src/global/trading-variable.service';
import { TaskExecutorService } from 'src/task-executor/task-executor.service';
import { ContractMonitorService } from './contract-monitor.service';

@Controller()
export class ApiController {
  constructor(
    private readonly apiService: ApiService,
    private readonly logger: LogsService,
    private readonly securityService: SecurityService,
    private readonly tradingVariableService: TradingVariableService,
    private readonly contractMonitorService: ContractMonitorService,
    private readonly taskExecutorService: TaskExecutorService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async executeCronForBotMonitor() {
    if (
      this.apiService.isPaused ||
      this.apiService.stopForTradingVariableLoading ||
      !this.securityService.isReady() ||
      this.tradingVariableService.status !== 'ready'
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

  @EventPattern(PATTERNS.Log)
  log(data: { severity: string; summary: string; details: string }) {
    this.logger.log({
      severity: data.severity as LogSeverity,
      summary: data.summary,
      details: data.details,
    });
  }

  @EventPattern(PATTERNS.NativeLog)
  nativeLog(data: { severity: string; summary: string; details: string }) {
    this.logger.nativeLog({
      severity: data.severity as LogSeverity,
      summary: data.summary,
      details: data.details,
    });
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

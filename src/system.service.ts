import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ContractMonitorService } from './contract-monitor.service';
import { TasksService } from './tasks/tasks.service';
import { TradingVariableService } from './global/trading-variable.service';

@Injectable()
export class SystemService {
  constructor(
    private contractMonitorService: ContractMonitorService,
    private tasksService: TasksService,
    private tradingVariableService: TradingVariableService,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async executeCron() {
    if (
      this.tasksService.status === 'ready' &&
      this.contractMonitorService.status === 'ready' &&
      this.tradingVariableService.status === 'ready'
    ) {
      // await this.contractMonitorService.checkContract(1);
      // await this.tasksService.performAvailableTasks();
    }
  }
}

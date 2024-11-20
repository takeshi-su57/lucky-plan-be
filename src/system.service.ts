import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ContractMonitorService } from './contracts/contract-monitor.service';
import { TasksService } from './tasks/tasks.service';

@Injectable()
export class SystemService {
  constructor(
    private contractMonitorService: ContractMonitorService,
    private tasksService: TasksService,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async executeCron() {
    if (
      this.tasksService.status === 'ready' &&
      this.contractMonitorService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContract(1);

      await this.tasksService.performAvailableTasks();
    }
  }
}

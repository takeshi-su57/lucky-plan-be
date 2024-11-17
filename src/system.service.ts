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
  contractMonitorCron() {
    if (this.contractMonitorService.status === 'ready') {
      // this.contractMonitorService.checkContract(1);
    }
  }

  @Cron(CronExpression.EVERY_SECOND)
  taskExecuteCron() {
    if (this.contractMonitorService.status === 'ready') {
      // this.contractMonitorService.checkContract(1);
    }
  }
}

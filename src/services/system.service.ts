import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ContractMonitorService } from './contract-monitor.service';

@Injectable()
export class SystemService {
  constructor(private contractMonitorService: ContractMonitorService) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  handleCheckContractMonitorStatusCron() {
    if (this.contractMonitorService.status === 'ready') {
      this.contractMonitorService.checkContractByChains();
    }
  }
}

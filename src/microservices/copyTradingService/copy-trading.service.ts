import { Injectable } from '@nestjs/common';

import { ServiceStatus } from 'src/types';

import { CopyTradingFlowService } from './copy-trading-flow.service';
import { ActionRouterService } from './components/action-router.service';
import { ContractMonitorService } from './components/contract-monitor.service';

import { TaskExecutorService } from './components/task-executor.service';

@Injectable()
export class CopyTradingService extends CopyTradingFlowService {
  status: ServiceStatus = ServiceStatus.READY;

  constructor(
    contractMonitor: ContractMonitorService,
    actionRouter: ActionRouterService,
    taskExecutor: TaskExecutorService,
  ) {
    super(contractMonitor, actionRouter, taskExecutor);
  }

  async run(): Promise<void> {
    this.status = ServiceStatus.PROCESS;

    try {
      await super.run();
    } finally {
      this.status = ServiceStatus.READY;
    }
  }
}

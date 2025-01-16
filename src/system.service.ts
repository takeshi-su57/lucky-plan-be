import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ContractMonitorService } from './contract-monitor.service';
import { TradingVariableService } from './global/trading-variable.service';
import { BotsService } from './bots/bots.service';
import { PnlSnapshotsService } from './trade-histories/pnlsnapshot.service';
import { TaskExecutorService } from './task-executor/task-executor.service';

@Injectable()
export class SystemService {
  constructor(
    private contractMonitorService: ContractMonitorService,
    private taskExecutorService: TaskExecutorService,
    private pnlSnapshotService: PnlSnapshotsService,
    private tradingVariableService: TradingVariableService,
    private botsService: BotsService,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async executeCron() {
    if (
      this.contractMonitorService.status === 'ready' &&
      this.tradingVariableService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContracts();
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async executeTaskCron() {
    if (
      this.taskExecutorService.status === 'ready' &&
      this.tradingVariableService.status === 'ready'
    ) {
      await this.taskExecutorService.performAvailableTasks();
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async executeCronForBots() {
    if (
      this.tradingVariableService.status === 'ready' &&
      this.botsService.status === 'ready'
    ) {
      await this.botsService.checkAndUpdateAllBots();
    }
  }

  // @Cron(CronExpression.EVERY_5_MINUTES)
  // async executeCronForSnapshot() {
  //   if (this.pnlSnapshotService.status === 'ready') {
  //     await this.pnlSnapshotService.updatePnlSnapshot();
  //   }
  // }
}

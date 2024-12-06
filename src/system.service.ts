import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ContractMonitorService } from './contract-monitor.service';
import { TasksService } from './tasks/tasks.service';
import { TradingVariableService } from './global/trading-variable.service';
import { BotsService } from './bots/bots.service';
import { PnlSnapshotsService } from './trade-histories/pnlsnapshot.service';

@Injectable()
export class SystemService {
  constructor(
    private contractMonitorService: ContractMonitorService,
    private tasksService: TasksService,
    private pnlSnapshotService: PnlSnapshotsService,
    private tradingVariableService: TradingVariableService,
    private botsService: BotsService,
  ) {}

  @Cron(CronExpression.EVERY_SECOND)
  async executeCron() {
    if (
      this.tasksService.status === 'ready' &&
      this.contractMonitorService.status === 'ready' &&
      this.tradingVariableService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContracts();
      await this.tasksService.performAvailableTasks();
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async executeCronForBots() {
    if (
      this.tradingVariableService.status === 'ready' &&
      this.botsService.status === 'ready'
    ) {
      await this.botsService.checkAndUpdateAllBots();
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async executeCronForSnapshot() {
    if (this.pnlSnapshotService.status === 'ready') {
      await this.pnlSnapshotService.dayUpdate();
    }
  }
}

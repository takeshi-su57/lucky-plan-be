import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ContractMonitorService } from './contract-monitor.service';
import { TradingVariableService } from './global/trading-variable.service';
import { BotsService } from './bots/bots.service';
import { PnlSnapshotsService } from './trade-histories/pnlsnapshot.service';
import { TaskExecutorService } from './task-executor/task-executor.service';

@Injectable()
export class SystemService {
  private isPaused = false;

  constructor(
    private contractMonitorService: ContractMonitorService,
    private taskExecutorService: TaskExecutorService,
    private pnlSnapshotService: PnlSnapshotsService,
    private tradingVariableService: TradingVariableService,
    private botsService: BotsService,
  ) {
    this.isPaused = false;
  }

  pauseSystem() {
    this.isPaused = true;
  }

  resumeSystem() {
    this.isPaused = false;
  }

  @Cron(CronExpression.EVERY_SECOND)
  async executeCronForBotMonitor() {
    if (this.isPaused) {
      return;
    }

    if (
      this.contractMonitorService.status.bot === 'ready' &&
      this.tradingVariableService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContractsForBots();
    }
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async executeCronForLeaderboardMonitor() {
    if (this.isPaused) {
      return;
    }

    if (
      this.contractMonitorService.status.leaderboard === 'ready' &&
      this.tradingVariableService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContractsForLeaderboard();
    }
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async executeTaskCron() {
    if (this.isPaused) {
      return;
    }

    if (
      this.taskExecutorService.status === 'ready' &&
      this.tradingVariableService.status === 'ready'
    ) {
      await this.taskExecutorService.performAvailableTasks();
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async executeCronForBots() {
    if (this.isPaused) {
      return;
    }

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

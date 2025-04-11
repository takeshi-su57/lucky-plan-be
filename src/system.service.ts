import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ContractMonitorService } from './contract-monitor.service';
import { TradingVariableService } from './global/trading-variable.service';
import { BotsService } from './bots/bots.service';
import { PnlSnapshotsService } from './trade-histories/pnlsnapshot.service';
import { TaskExecutorService } from './task-executor/task-executor.service';
import { PlansService } from './plans/plans.service';
import * as dayjs from 'dayjs';
import * as utc from 'dayjs/plugin/utc';
import * as timezone from 'dayjs/plugin/timezone';
import { FollowerService } from './follower/follower.service';
import { AutoPlansService } from './plans/autoplans.service';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class SystemService {
  private isPaused = false;

  constructor(
    private contractMonitorService: ContractMonitorService,
    private taskExecutorService: TaskExecutorService,
    private pnlSnapshotService: PnlSnapshotsService,
    private tradingVariableService: TradingVariableService,
    private botsService: BotsService,
    private plansService: PlansService,
    private autoPlansService: AutoPlansService,
  ) {
    this.isPaused = false;

    console.log(this.getServerTime());
  }

  pauseSystem() {
    this.isPaused = true;

    return true;
  }

  resumeSystem() {
    this.isPaused = false;

    return true;
  }

  isSystemPaused() {
    return this.isPaused;
  }

  @Cron(CronExpression.EVERY_SECOND)
  async executeCronForBotMonitor() {
    if (this.isPaused) {
      return;
    }

    if (
      this.contractMonitorService.status.bot === 'ready' &&
      this.tradingVariableService.status === 'ready' &&
      this.taskExecutorService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContractsForBots();
    }
  }

  @Cron(CronExpression.EVERY_SECOND)
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

  @Cron(CronExpression.EVERY_MINUTE)
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

  @Cron(CronExpression.EVERY_5_MINUTES)
  async executeCronForPlans() {
    if (this.isPaused) {
      return;
    }

    if (this.plansService.status === 'ready') {
      await this.plansService.checkAndUpdateAllPlans();
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async executeCronForSnapshot() {
    if (this.isPaused) {
      return;
    }

    if (this.pnlSnapshotService.status === 'ready') {
      await this.pnlSnapshotService.dynamicSnapshotBuild(
        dayjs(new Date()).format('YYYY-MM-DD'),
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async executeCronForAutoPlans() {
    if (this.isPaused) {
      return;
    }

    if (this.autoPlansService.status === 'ready') {
      await this.autoPlansService.createAutoPlans();
    }
  }

  getServerTime() {
    return {
      timezone: dayjs.tz.guess(),
      timestamp: dayjs().utc().unix(),
    };
  }
}

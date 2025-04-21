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
import { AutoPlansService } from './plans/autoplans.service';
import { SecurityService } from './global/security.service';

dayjs.extend(utc);
dayjs.extend(timezone);

@Injectable()
export class SystemService {
  private isPaused = true;
  private count = 0;

  constructor(
    private contractMonitorService: ContractMonitorService,
    private taskExecutorService: TaskExecutorService,
    private pnlSnapshotService: PnlSnapshotsService,
    private tradingVariableService: TradingVariableService,
    private botsService: BotsService,
    private plansService: PlansService,
    private autoPlansService: AutoPlansService,
    private securityService: SecurityService,
  ) {
    this.isPaused = true;
    this.count = 0;
  }

  pauseSystem() {
    this.isPaused = true;

    return true;
  }

  async resumeSystem(password: string | null) {
    if (this.securityService.isSafeApp) {
      if (!password) {
        throw new Error('Required Password');
      }

      await this.securityService.loadPassword(password);
    }

    this.isPaused = false;

    return true;
  }

  async makeSafeApp(password: string) {
    this.isPaused = true;

    const promise = new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const result = await this.securityService.makeSafeApp(password);

          resolve(result);
        } catch (err) {
          reject(err);
        }
      }, 5000);
    });

    const result = await promise;

    if (result) {
      this.isPaused = false;
    }

    return result;
  }

  async changePassword(oldPassword: string, newPassword: string) {
    this.isPaused = true;

    const promise = new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const result = await this.securityService.changePassword(
            oldPassword,
            newPassword,
          );
          resolve(result);
        } catch (err) {
          reject(err);
        }
      }, 5000);
    });

    const result = await promise;

    if (result) {
      this.isPaused = false;
    }

    return result;
  }

  isSystemPaused() {
    return this.isPaused;
  }

  @Cron(CronExpression.EVERY_SECOND)
  async executeCronForBotMonitor() {
    if (this.isPaused || !this.securityService.isReady()) {
      return;
    }

    if (
      this.contractMonitorService.status.bot === 'ready' &&
      this.tradingVariableService.status === 'ready' &&
      this.taskExecutorService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContractsForBots();
      await this.taskExecutorService.performAvailableTasks();

      if (this.botsService.status === 'ready' && this.count % 60 === 0) {
        await this.botsService.checkAndUpdateAllBots();
      }

      this.count = this.count + 1;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async executeCronForLeaderboardMonitor() {
    if (this.isPaused || !this.securityService.isReady()) {
      return;
    }

    if (
      this.contractMonitorService.status.leaderboard === 'ready' &&
      this.tradingVariableService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContractsForLeaderboard();
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async executeCronForPlans() {
    if (this.isPaused || !this.securityService.isReady()) {
      return;
    }

    if (this.plansService.status === 'ready') {
      await this.plansService.checkAndUpdateAllPlans();
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async executeCronForSnapshot() {
    if (this.isPaused || !this.securityService.isReady()) {
      return;
    }

    if (this.pnlSnapshotService.status === 'ready') {
      await this.pnlSnapshotService.dynamicSnapshotBuild(
        dayjs(new Date()).format('YYYY-MM-DD'),
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_7AM)
  async executeCronForAutoPlans() {
    if (this.isPaused || !this.securityService.isReady()) {
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

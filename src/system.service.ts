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
import { AutoPlansV2Service } from './plans/autoplansV2.service';
import { SecurityService } from './global/security.service';
import { spawn } from 'child_process';
import * as path from 'path';

import { delay } from './utils';

dayjs.extend(utc);
dayjs.extend(timezone);

const runInNewTerminal = (cmd: string, args: string[]) => {
  const terminalCommand =
    process.platform === 'darwin' ? 'osascript' : 'gnome-terminal';

  let commandArgs;

  if (process.platform === 'darwin') {
    commandArgs = [
      '-e',
      `tell app "Terminal" to do script "${cmd} ${args.join(' ')}"`,
    ];
  } else {
    commandArgs = ['--', cmd, ...args];
  }

  const child = spawn(terminalCommand, commandArgs, {
    stdio: 'ignore',
    detached: true,
  });

  child.unref();
};

@Injectable()
export class SystemService {
  private isPaused = true;
  private stopForTradingVariableLoading = false;
  private pnlCount = 1;

  constructor(
    private contractMonitorService: ContractMonitorService,
    private taskExecutorService: TaskExecutorService,
    private pnlSnapshotService: PnlSnapshotsService,
    private tradingVariableService: TradingVariableService,
    private botsService: BotsService,
    private plansService: PlansService,
    private autoPlansV2Service: AutoPlansV2Service,
    private securityService: SecurityService,
  ) {
    this.isPaused = true;
    this.pnlCount = 1;
    this.stopForTradingVariableLoading = false;

    this.reloadTradingVariables();
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

  async upgrade() {
    this.pauseSystem();

    await delay(10_000);

    runInNewTerminal('bash', [path.join(__dirname, 'upgrade.js')]);

    // Spawning the process in detached mode
    const upgradeProcess = spawn('node', [path.join(__dirname, 'upgrade.js')], {
      detached: true,
      stdio: 'ignore', // Ignore output to prevent the parent process from waiting
    });

    // Allow the parent to exit independently of the child
    upgradeProcess.unref();

    // Gracefully exit the app
    setTimeout(() => {
      process.exit(0);
    }, 5000); // short delay to allow child process to start

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

  @Cron(CronExpression.EVERY_5_SECONDS)
  async executeCronForBotMonitor() {
    if (
      this.isPaused ||
      this.stopForTradingVariableLoading ||
      !this.securityService.isReady() ||
      this.tradingVariableService.status !== 'ready'
    ) {
      return;
    }

    if (
      this.contractMonitorService.status.bot === 'ready' &&
      this.taskExecutorService.status === 'ready'
    ) {
      await this.contractMonitorService.checkContractsForBots();
      await this.taskExecutorService.performAvailableTasks();
      await this.taskExecutorService.handleFailedTasks();
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkAndUpdateAllBots() {
    if (
      this.isPaused ||
      this.stopForTradingVariableLoading ||
      !this.securityService.isReady() ||
      this.tradingVariableService.status !== 'ready'
    ) {
      return;
    }

    if (this.botsService.status === 'ready') {
      await this.botsService.checkAndUpdateAllBots();
    }

    if (this.plansService.status === 'ready') {
      await this.plansService.checkAndUpdateAllPlans();
    }
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkContractsForLeaderboard() {
    if (
      this.isPaused ||
      this.stopForTradingVariableLoading ||
      !this.securityService.isReady() ||
      this.tradingVariableService.status !== 'ready'
    ) {
      return;
    }

    if (this.contractMonitorService.status.leaderboard === 'ready') {
      await this.contractMonitorService.checkContractsForLeaderboard();
    }
  }

  @Cron(CronExpression.EVERY_3_HOURS)
  async reloadTradingVariables() {
    if (this.tradingVariableService.status !== 'ready') {
      return;
    }

    this.stopForTradingVariableLoading = true;

    setTimeout(() => {
      this.tradingVariableService.loadTradingVariables().then(() => {
        console.log('trading variables reloaded');
      });

      this.stopForTradingVariableLoading = false;
    }, 20_000);
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

      if (
        this.autoPlansV2Service.status === 'ready' &&
        this.pnlCount % 3 === 0
      ) {
        await this.autoPlansV2Service.createAutoPlans();
      }

      this.pnlCount = this.pnlCount + 1;
    }
  }

  getServerTime() {
    return {
      timezone: dayjs.tz.guess(),
      timestamp: dayjs().utc().unix(),
    };
  }
}

import { Controller, Inject } from '@nestjs/common';
import { ClientProxy, EventPattern } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as dayjs from 'dayjs';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { delay } from 'src/utils';

import { PnlSnapshotsService } from 'src/trade-histories/pnlsnapshot.service';
import { TradingVariableService } from 'src/global/trading-variable.service';
import { BotsService } from 'src/bots/bots.service';
import { PlansService } from 'src/plans/plans.service';
import { AutoPlansV2Service } from 'src/plans/autoplansV2.service';
import { ContractMonitorService } from './contract-monitor.service';

@Controller()
export class LeaderboardController {
  private stopForTradingVariableLoading = false;
  private pnlCount = 1;
  private isReceivedKillProcess = false;

  constructor(
    private contractMonitorService: ContractMonitorService,
    private pnlSnapshotService: PnlSnapshotsService,
    private tradingVariableService: TradingVariableService,
    private botsService: BotsService,
    private plansService: PlansService,
    private autoPlansV2Service: AutoPlansV2Service,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
  ) {
    this.pnlCount = 1;
    this.stopForTradingVariableLoading = false;
    this.isReceivedKillProcess = false;

    this.reloadTradingVariables().then(() => {
      this.client.emit(PATTERNS.ProcessStatus, {
        service: SERVICE_NAMES.LEADERBOARD_SERVICE,
        status: ServiceStatus.READY,
      });
    });
  }

  private async reloadTradingVariables() {
    if (this.tradingVariableService.status !== 'ready') {
      return;
    }

    this.stopForTradingVariableLoading = true;

    const promise = new Promise((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, 20_000),
    );

    await promise;

    this.stopForTradingVariableLoading = false;

    await this.tradingVariableService.loadTradingVariables();

    console.log('trading variables reloaded');
  }

  @EventPattern(PATTERNS.killProcess)
  async killProcess() {
    this.isReceivedKillProcess = true;

    while (true) {
      await delay(1000);

      if (
        this.tradingVariableService.status !== 'ready' ||
        this.contractMonitorService.status !== 'ready' ||
        this.botsService.status !== 'ready' ||
        this.plansService.status !== 'ready'
      ) {
        continue;
      }

      break;
    }

    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.LEADERBOARD_SERVICE,
      status: ServiceStatus.KILLED,
    });

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async checkAndUpdateAllBots() {
    if (
      this.stopForTradingVariableLoading ||
      this.tradingVariableService.status !== 'ready' ||
      this.isReceivedKillProcess
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
      this.stopForTradingVariableLoading ||
      this.tradingVariableService.status !== 'ready' ||
      this.isReceivedKillProcess
    ) {
      return;
    }

    if (this.contractMonitorService.status === 'ready') {
      await this.contractMonitorService.checkContractsForLeaderboard();
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async executeCronForSnapshot() {
    if (this.isReceivedKillProcess) {
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
        await this.reloadTradingVariables();

        await this.autoPlansV2Service.createAutoPlans();
      }

      this.pnlCount = this.pnlCount + 1;
    }
  }
}

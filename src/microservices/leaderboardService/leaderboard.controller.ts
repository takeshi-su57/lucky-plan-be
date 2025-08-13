import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { ClientProxy, EventPattern } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as dayjs from 'dayjs';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { delay, getReadableError } from 'src/utils';

import { PnlSnapshotsService } from 'src/microservices/apiService/modules/trade-histories/pnlsnapshot.service';
import { GnsV10Service } from 'src/global/gnsV10.service';

import { ContractMonitorService } from './contract-monitor.service';
import { LogsService } from 'src/global/logs.service';
import { AutoPlansService } from '../apiService/modules/plans/autoplans.service';

@Controller()
export class LeaderboardController implements OnApplicationBootstrap {
  private isReceivedKillProcess = false;
  private isAppBootstrapped = false;
  private count = 0;

  constructor(
    private contractMonitorService: ContractMonitorService,
    private pnlSnapshotService: PnlSnapshotsService,
    private gnsV10Service: GnsV10Service,
    private autoPlansService: AutoPlansService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly logger: LogsService,
  ) {
    this.isReceivedKillProcess = false;
  }

  onApplicationBootstrap() {
    this.isAppBootstrapped = true;
  }

  private async reloadTradingVariables() {
    this.gnsV10Service.status = ServiceStatus.PAUSED;

    await delay(20_000);

    await this.gnsV10Service.loadTradingVariables();

    await this.logger.nativeLog({
      severity: 'Info',
      summary: 'leaderboard.controller>reloadTradingVariables',
      details: 'trading variables reloaded',
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    this.isReceivedKillProcess = true;

    this.logger.nativeLog({
      severity: 'Info',
      summary: 'leaderboard service killProcess',
      details: 'received kill process event',
    });

    while (true) {
      await delay(1000);

      if (this.contractMonitorService.status !== ServiceStatus.READY) {
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

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkContractsForLeaderboard() {
    if (
      this.gnsV10Service.status !== ServiceStatus.READY ||
      this.isReceivedKillProcess ||
      this.contractMonitorService.status !== ServiceStatus.READY
    ) {
      return;
    }

    await this.contractMonitorService.checkContractsForLeaderboard();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async executeCronForSnapshot() {
    if (
      this.isReceivedKillProcess ||
      this.pnlSnapshotService.status !== ServiceStatus.READY
    ) {
      return;
    }

    try {
      await this.reloadTradingVariables();

      await this.pnlSnapshotService.dynamicSnapshotBuild(
        dayjs(new Date()).format('YYYY-MM-DD'),
      );

      if (this.count % 3 === 0) {
        await this.autoPlansService.createAutoPlans();
      }

      this.count++;
    } catch (err) {
      this.logger.nativeLog({
        severity: 'Error',
        summary: 'leaderboard.controller>executeCronForSnapshot',
        details: getReadableError(err),
      });
    }
  }

  @EventPattern(PATTERNS.ProcessStatus)
  async updateProcessStatus(data: { service: string; status: ServiceStatus }) {
    if (
      data.service === SERVICE_NAMES.WEB3_SERVICE &&
      data.status === ServiceStatus.READY
    ) {
      await this.logger.nativeLog({
        severity: 'Info',
        summary: 'leaderboard.controller>updateProcessStatus',
        details: `web3 service is ready, reloading trading variables`,
      });

      while (true) {
        await delay(1000);

        if (!this.isAppBootstrapped) {
          continue;
        }

        await this.reloadTradingVariables();

        await this.client.emit(PATTERNS.ProcessStatus, {
          service: SERVICE_NAMES.LEADERBOARD_SERVICE,
          status: ServiceStatus.READY,
        });

        break;
      }
    }
  }
}

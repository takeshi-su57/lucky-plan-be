import { Controller, Inject } from '@nestjs/common';
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

@Controller()
export class LeaderboardController {
  private isReceivedKillProcess = false;

  constructor(
    private contractMonitorService: ContractMonitorService,
    private pnlSnapshotService: PnlSnapshotsService,
    private gnsV10Service: GnsV10Service,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly logger: LogsService,
  ) {
    this.isReceivedKillProcess = false;
  }

  private async reloadTradingVariables() {
    if (this.gnsV10Service.status !== ServiceStatus.READY) {
      return;
    }

    this.gnsV10Service.status = ServiceStatus.PAUSED;

    const promise = new Promise((resolve) =>
      setTimeout(() => {
        resolve(true);
      }, 20_000),
    );

    await promise;

    await this.gnsV10Service.loadTradingVariables();

    console.log('trading variables reloaded');
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    this.isReceivedKillProcess = true;

    while (true) {
      await delay(1000);

      if (
        this.gnsV10Service.status !== ServiceStatus.READY ||
        this.contractMonitorService.status !== ServiceStatus.READY
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

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkContractsForLeaderboard() {
    if (
      this.gnsV10Service.status !== ServiceStatus.READY ||
      this.isReceivedKillProcess
    ) {
      return;
    }

    if (this.contractMonitorService.status === ServiceStatus.READY) {
      await this.contractMonitorService.checkContractsForLeaderboard();
    }
  }

  @Cron(CronExpression.EVERY_HOUR)
  async executeCronForSnapshot() {
    if (this.isReceivedKillProcess) {
      return;
    }

    if (this.pnlSnapshotService.status !== ServiceStatus.READY) {
      return;
    }

    try {
      await this.reloadTradingVariables();

      await this.pnlSnapshotService.dynamicSnapshotBuild(
        dayjs(new Date()).format('YYYY-MM-DD'),
      );
    } catch (err) {
      this.logger.nativeLog({
        severity: 'Error',
        summary: 'leaderboard.controller>executeCronForSnapshot',
        details: getReadableError(err),
      });
    }
  }

  @EventPattern(PATTERNS.ProcessStatus)
  updateProcessStatus(data: { service: string; status: ServiceStatus }) {
    if (data.service === SERVICE_NAMES.WEB3_SERVICE) {
      this.gnsV10Service.status = data.status;

      if (data.status === ServiceStatus.READY) {
        this.reloadTradingVariables().then(() =>
          this.client.emit(PATTERNS.ProcessStatus, {
            service: SERVICE_NAMES.LEADERBOARD_SERVICE,
            status: ServiceStatus.READY,
          }),
        );
      }
    }
  }
}

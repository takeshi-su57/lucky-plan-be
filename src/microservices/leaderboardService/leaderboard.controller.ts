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
  private stopForTradingVariableLoading = false;
  private isReceivedKillProcess = false;

  constructor(
    private contractMonitorService: ContractMonitorService,
    private pnlSnapshotService: PnlSnapshotsService,
    private gnsV10Service: GnsV10Service,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly logger: LogsService,
  ) {
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
    if (this.gnsV10Service.status !== 'ready') {
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

    await this.gnsV10Service.loadTradingVariables();

    console.log('trading variables reloaded');
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    this.isReceivedKillProcess = true;

    while (true) {
      await delay(1000);

      if (
        this.gnsV10Service.status !== 'ready' ||
        this.contractMonitorService.status !== 'ready'
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
      this.stopForTradingVariableLoading ||
      this.gnsV10Service.status !== 'ready' ||
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

    if (this.pnlSnapshotService.status !== 'ready') {
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
}

import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import {
  ClientProxy,
  EventPattern,
  MessagePattern,
} from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Platform } from '@prisma/client';
import * as dayjs from 'dayjs';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { delay, getReadableError } from 'src/utils';

import { PnlSnapshotsService } from 'src/microservices/apiService/modules/trade-histories/pnlsnapshot.service';
import { GnsService } from 'src/global/gns.service';

import { LeaderboardService } from './leaderboard.service';
import { LogsService } from 'src/global/logs.service';
import { AutoPlansService } from '../apiService/modules/plans/autoplans.service';
import { StartAdaptionPayload } from './types';
import { PnlSnapshotsV2Service } from '../apiService/modules/trade-histories/pnlsnapshotV2.service';

@Controller()
export class LeaderboardController implements OnApplicationBootstrap {
  private isAppBootstrapped = false;
  private count = 0;

  constructor(
    private leaderboardService: LeaderboardService,
    private pnlSnapshotService: PnlSnapshotsService,
    private pnlSnapshotV2Service: PnlSnapshotsV2Service,
    private gnsService: GnsService,
    private autoPlansService: AutoPlansService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly logger: LogsService,
  ) {}

  onApplicationBootstrap() {
    this.isAppBootstrapped = true;
  }

  private async reloadTradingVariables() {
    this.gnsService.status = ServiceStatus.PAUSED;

    await delay(10_000);

    await this.gnsService.loadTradingVariables();

    await this.logger.nativeLog({
      severity: 'Info',
      summary: 'leaderboard.controller>reloadTradingVariables',
      details: 'trading variables reloaded',
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    this.leaderboardService.isReceivedKillProcess = true;

    this.logger.nativeLog({
      severity: 'Info',
      summary: 'leaderboard service killProcess',
      details: 'received kill process event',
    });

    while (true) {
      await delay(1000);

      const isBusy = Object.values(this.leaderboardService.status).some(
        (status) => status === ServiceStatus.PROCESS,
      );

      if (isBusy) {
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

  @MessagePattern(PATTERNS.Leaderboard.GetAdaptionStatus)
  getAdaptionStatus() {
    return this.leaderboardService.getAllStatus();
  }

  @MessagePattern(PATTERNS.Leaderboard.StartAdaption)
  startAdaption(payload: StartAdaptionPayload) {
    this.leaderboardService.startAdaption(
      payload.contractId,
      payload.shouldRestart,
    );

    return true;
  }

  @MessagePattern(PATTERNS.Leaderboard.BuildPnlSnapshotV2)
  async buildPnlSnapshotV2(payload: {
    platform: Platform;
    dateStr: string;
    isForceBuild: boolean;
  }) {
    return this.pnlSnapshotV2Service.buildSnapshots(
      payload.platform,
      payload.dateStr,
      payload.isForceBuild,
    );
  }

  @MessagePattern(PATTERNS.Leaderboard.DynamicSnapshotV2Build)
  async dynamicSnapshotV2Build(payload: {
    platform: Platform;
    dateStr: string;
    isForceBuild: boolean;
  }) {
    return this.pnlSnapshotV2Service.buildSnapshots(
      payload.platform,
      payload.dateStr,
      payload.isForceBuild,
    );
  }

  @MessagePattern(PATTERNS.Leaderboard.InitializePnlSnapshotV2)
  async initializePnlSnapshotV2(payload: {
    platform: Platform;
    beginingDate: Date;
    isForceBuild: boolean;
  }) {
    return this.pnlSnapshotV2Service.initializePnlSnapshot(
      payload.platform,
      payload.beginingDate,
      payload.isForceBuild,
    );
  }

  @MessagePattern(PATTERNS.Leaderboard.BuildPnlSnapshot)
  async buildPnlSnapshot(payload: { dateStr: string; isForceBuild: boolean }) {
    return this.pnlSnapshotService.buildSnapshots(
      payload.dateStr,
      payload.isForceBuild,
    );
  }

  @MessagePattern(PATTERNS.Leaderboard.DynamicSnapshotBuild)
  async dynamicSnapshotBuild(payload: { dateStr: string }) {
    return this.pnlSnapshotService.dynamicSnapshotBuild(payload.dateStr);
  }

  @MessagePattern(PATTERNS.Leaderboard.InitializePnlSnapshot)
  async initializePnlSnapshot(payload: {
    beginingDate: Date;
    isForceBuild: boolean;
  }) {
    return this.pnlSnapshotService.initializePnlSnapshot(
      payload.beginingDate,
      payload.isForceBuild,
    );
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkContractsForLeaderboard() {
    const isLeaderboardBusy = Object.values(
      this.leaderboardService.status,
    ).some((status) => status === ServiceStatus.PROCESS);

    if (
      this.gnsService.status !== ServiceStatus.READY ||
      this.leaderboardService.isReceivedKillProcess ||
      isLeaderboardBusy
    ) {
      return;
    }

    await this.leaderboardService.checkContractsForLeaderboard();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async executeCronForSnapshot() {
    if (
      this.leaderboardService.isReceivedKillProcess ||
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

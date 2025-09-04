import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import {
  ClientProxy,
  EventPattern,
  MessagePattern,
  Payload,
} from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Platform } from '@prisma/client';
import * as dayjs from 'dayjs';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { delay, getReadableError } from 'src/utils';

import { PnlSnapshotsService } from 'src/microservices/apiService/modules/trade-histories/pnlsnapshot.service';
import { GnsService } from 'src/web3/platform/gns/gns.service';

import { LeaderboardService } from './leaderboard.service';
import { LogsService } from 'src/global/logs.service';
import { AutoPlansService } from '../apiService/modules/plans/autoplans.service';
import { StartAdaptionPayload } from './types';
import { PnlSnapshotsV2Service } from '../apiService/modules/trade-histories/pnlsnapshotV2.service';

@Controller()
export class LeaderboardController implements OnApplicationBootstrap {
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

  async onApplicationBootstrap() {
    await this.reloadTradingVariables();

    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.LEADERBOARD_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
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

  @EventPattern(PATTERNS.AskProcessStatus)
  async askProcessStatus() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.LEADERBOARD_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess(@Payload() payload?: { service?: string }) {
    if (
      payload?.service &&
      payload.service !== SERVICE_NAMES.LEADERBOARD_SERVICE
    ) {
      return;
    }

    this.leaderboardService.isReceivedKillProcess = true;

    this.logger.nativeLog({
      severity: 'Info',
      summary: 'leaderboard service killProcess',
      details: 'received kill process event',
    });

    while (true) {
      await delay(1000);

      await this.logger.nativeLog({
        severity: 'Info',
        summary: 'leaderboard service killProcess',
        details: JSON.stringify(this.leaderboardService.status, null, 2),
      });

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
      pid: process.pid,
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
    this.pnlSnapshotV2Service.buildSnapshots(
      payload.platform,
      payload.dateStr,
      payload.isForceBuild,
    );

    return true;
  }

  @MessagePattern(PATTERNS.Leaderboard.DynamicSnapshotV2Build)
  async dynamicSnapshotV2Build(payload: {
    platform: Platform;
    dateStr: string;
    isForceBuild: boolean;
  }) {
    this.pnlSnapshotV2Service.buildSnapshots(
      payload.platform,
      payload.dateStr,
      payload.isForceBuild,
    );

    return true;
  }

  @MessagePattern(PATTERNS.Leaderboard.InitializePnlSnapshotV2)
  async initializePnlSnapshotV2(payload: {
    platform: Platform;
    beginingDate: Date;
    isForceBuild: boolean;
  }) {
    this.pnlSnapshotV2Service.initializePnlSnapshot(
      payload.platform,
      payload.beginingDate,
      payload.isForceBuild,
    );

    return true;
  }

  @MessagePattern(PATTERNS.Leaderboard.BuildPnlSnapshot)
  async buildPnlSnapshot(payload: { dateStr: string; isForceBuild: boolean }) {
    this.pnlSnapshotService.buildSnapshots(
      payload.dateStr,
      payload.isForceBuild,
    );

    return true;
  }

  @MessagePattern(PATTERNS.Leaderboard.DynamicSnapshotBuild)
  async dynamicSnapshotBuild(payload: { dateStr: string }) {
    this.pnlSnapshotService.dynamicSnapshotBuild(payload.dateStr);

    return true;
  }

  @MessagePattern(PATTERNS.Leaderboard.InitializePnlSnapshot)
  async initializePnlSnapshot(payload: {
    beginingDate: Date;
    isForceBuild: boolean;
  }) {
    this.pnlSnapshotService.initializePnlSnapshot(
      payload.beginingDate,
      payload.isForceBuild,
    );

    return true;
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

      await this.pnlSnapshotV2Service.dynamicSnapshotBuild(
        Platform.GNS,
        dayjs(new Date()).format('YYYY-MM-DD'),
      );

      await this.pnlSnapshotV2Service.dynamicSnapshotBuild(
        Platform.GMX,
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
}

import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import {
  ClientProxy,
  EventPattern,
  MessagePattern,
  Payload,
} from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import dayjs from 'dayjs';

import { ServiceStatus } from 'src/types';
import { Platform } from 'generated/prisma/enums';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { LeaderboardService } from './leaderboard.service';
import { LogsService } from 'src/global/logs.service';
import { StartAdaptionPayload } from './types';
import { PnlSnapshotsService } from '../apiService/modules/trade-histories/pnlsnapshot.service';
import { getReadableError } from 'src/utils';

@Controller()
export class LeaderboardController implements OnApplicationBootstrap {
  private count = 0;

  constructor(
    private pnlSnapshotService: PnlSnapshotsService,
    private leaderboardService: LeaderboardService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly logger: LogsService,
  ) {}

  async onApplicationBootstrap() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.LEADERBOARD_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
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

  @Cron(CronExpression.EVERY_30_SECONDS)
  async checkContractsForLeaderboard() {
    const isLeaderboardBusy = Object.values(
      this.leaderboardService.status,
    ).some((status) => status === ServiceStatus.PROCESS);

    if (this.leaderboardService.isReceivedKillProcess || isLeaderboardBusy) {
      return;
    }

    await this.leaderboardService.checkContractsForLeaderboard();
  }

  @Cron(CronExpression.EVERY_HOUR)
  async executeCronForSnapshot() {
    if (this.pnlSnapshotService.status !== ServiceStatus.READY) {
      return;
    }

    try {
      for (const platform of Object.values(Platform)) {
        await this.pnlSnapshotService.dynamicSnapshotBuild(
          platform,
          dayjs(new Date()).format('YYYY-MM-DD'),
        );

        await this.pnlSnapshotService.removePnlSnapshot(
          platform,
          dayjs(new Date()).subtract(30, 'days').format('YYYY-MM-DD'),
        );
      }

      this.count++;
    } catch (err) {
      this.logger.nativeLog({
        severity: 'Error',
        summary: 'snapshot.controller>executeCronForSnapshot',
        details: getReadableError(err),
      });
    }
  }
}

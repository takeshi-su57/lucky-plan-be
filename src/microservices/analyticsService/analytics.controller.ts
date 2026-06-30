import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import dayjs from 'dayjs';

import { Platform } from 'generated/prisma/enums';
import { LogsService } from 'src/global/logs.service';
import { PnlSnapshotsService } from 'src/microservices/apiService/modules/trade-histories/pnlsnapshot.service';
import { ServiceStatus } from 'src/types';
import { getReadableError } from 'src/utils';
import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { isAnalyticsServiceName } from './analytics.service-names';
import { LeaderboardService } from './modules/leaderboard/leaderboard.service';

@Controller()
export class AnalyticsController implements OnApplicationBootstrap {
  constructor(
    private readonly pnlSnapshotService: PnlSnapshotsService,
    private readonly leaderboardService: LeaderboardService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private readonly client: ClientProxy,
    private readonly logger: LogsService,
  ) {}

  async onApplicationBootstrap() {
    await this.emitProcessStatus(ServiceStatus.READY);
  }

  @EventPattern(PATTERNS.AskProcessStatus)
  async askProcessStatus() {
    await this.emitProcessStatus(ServiceStatus.READY);
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess(@Payload() payload?: { service?: string }) {
    if (payload?.service && !isAnalyticsServiceName(payload.service)) {
      return;
    }

    this.leaderboardService.isReceivedKillProcess = true;

    await this.logger.nativeLog({
      severity: 'Info',
      summary: 'analytics service killProcess',
      details: 'received kill process event',
    });

    await this.emitProcessStatus(ServiceStatus.KILLED);

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
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
          dayjs(new Date()).subtract(90, 'days').format('YYYY-MM-DD'),
        );
      }
    } catch (err) {
      await this.logger.nativeLog({
        severity: 'Error',
        summary: 'analytics.controller>executeCronForSnapshot',
        details: getReadableError(err),
      });
    }
  }

  private async emitProcessStatus(status: ServiceStatus) {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.ANALYTICS_SERVICE,
      pid: process.pid,
      status,
    });
  }
}

import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import {
  ClientProxy,
  EventPattern,
  MessagePattern,
  Payload,
} from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Platform } from 'generated/prisma/client';
import dayjs from 'dayjs';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { getReadableError } from 'src/utils';

import { LogsService } from 'src/global/logs.service';
import { PnlSnapshotsService } from '../apiService/modules/trade-histories/pnlsnapshot.service';

@Controller()
export class SnapshotController implements OnApplicationBootstrap {
  private count = 0;

  constructor(
    private pnlSnapshotService: PnlSnapshotsService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly logger: LogsService,
  ) {}

  async onApplicationBootstrap() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.SNAPSHOT_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.AskProcessStatus)
  async askProcessStatus() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.SNAPSHOT_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess(@Payload() payload?: { service?: string }) {
    if (
      payload?.service &&
      payload.service !== SERVICE_NAMES.SNAPSHOT_SERVICE
    ) {
      return;
    }
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.SNAPSHOT_SERVICE,
      pid: process.pid,
      status: ServiceStatus.KILLED,
    });

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
  }

  @MessagePattern(PATTERNS.Snapshot.BuildPnlSnapshotV2)
  async buildPnlSnapshotV2(payload: {
    platform: Platform;
    dateStr: string;
    isForceBuild: boolean;
  }) {
    this.pnlSnapshotService.buildSnapshots(
      payload.platform,
      payload.dateStr,
      payload.isForceBuild,
    );

    return true;
  }

  @MessagePattern(PATTERNS.Snapshot.DynamicSnapshotV2Build)
  async dynamicSnapshotV2Build(payload: {
    platform: Platform;
    dateStr: string;
  }) {
    this.logger.nativeLog({
      severity: 'Info',
      summary: 'snapshot.controller>dynamicSnapshotV2Build',
      details: JSON.stringify(payload, null, 2),
    });

    this.pnlSnapshotService.dynamicSnapshotBuild(
      payload.platform,
      payload.dateStr,
    );

    return true;
  }

  @MessagePattern(PATTERNS.Snapshot.InitializePnlSnapshotV2)
  async initializePnlSnapshotV2(payload: {
    platform: Platform;
    beginingDate: Date;
    isForceBuild: boolean;
  }) {
    this.pnlSnapshotService.initializePnlSnapshot(
      payload.platform,
      payload.beginingDate,
      payload.isForceBuild,
    );

    return true;
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
          dayjs(new Date()).subtract(1, 'week').format('YYYY-MM-DD'),
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

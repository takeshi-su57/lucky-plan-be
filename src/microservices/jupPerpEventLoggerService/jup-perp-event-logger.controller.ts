import { Controller, Inject } from '@nestjs/common';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { ServiceStatus } from 'src/types';
import { JupPerpEventLoggerService } from './jup-perp-event-logger.service';
import { LogsService } from 'src/global/logs.service';

@Controller()
export class JupPerpEventLoggerController {
  constructor(
    private readonly jupPerpEventLoggerService: JupPerpEventLoggerService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly logger: LogsService,
  ) {
    this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.JUP_PERP_EVENT_LOGGER_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.AskProcessStatus)
  async askProcessStatus() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.JUP_PERP_EVENT_LOGGER_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess(@Payload() payload?: { service?: string }) {
    if (
      payload?.service &&
      payload.service !== SERVICE_NAMES.JUP_PERP_EVENT_LOGGER_SERVICE
    ) {
      return;
    }

    this.logger.nativeLog({
      severity: 'Info',
      summary: 'jup perp event logger service killProcess',
      details: 'received kill process event',
    });

    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.JUP_PERP_EVENT_LOGGER_SERVICE,
      pid: process.pid,
      status: ServiceStatus.KILLED,
    });

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
  }

  @Cron(CronExpression.EVERY_SECOND)
  async executeCronForJupPerpEventLogger() {
    if (this.jupPerpEventLoggerService.status !== ServiceStatus.READY) {
      return;
    }

    await this.jupPerpEventLoggerService.pullEventsFromSolana();
  }
}

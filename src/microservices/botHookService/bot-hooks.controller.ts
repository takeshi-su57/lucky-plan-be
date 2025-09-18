import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import {
  ClientProxy,
  EventPattern,
  MessagePattern,
  Payload,
} from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { LogsService } from 'src/global/logs.service';
import { BotHooksService } from './bot-hooks.service';

@Controller()
export class BotHooksController implements OnApplicationBootstrap {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly botHookService: BotHooksService,
    private readonly logger: LogsService,
  ) {}

  async onApplicationBootstrap() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.BOT_HOOKS_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @MessagePattern(PATTERNS.BotHook.IsRunning)
  isBotHookRunning() {
    return this.botHookService.isRunning;
  }

  @EventPattern(PATTERNS.AskProcessStatus)
  async askProcessStatus() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.BOT_HOOKS_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
  }

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess(@Payload() payload?: { service?: string }) {
    if (
      payload?.service &&
      payload.service !== SERVICE_NAMES.BOT_HOOKS_SERVICE
    ) {
      return;
    }

    this.botHookService.stop();

    this.logger.nativeLog({
      severity: 'Info',
      summary: 'Bot hooks service killProcess',
      details: 'received kill process event',
    });

    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.BOT_HOOKS_SERVICE,
      pid: process.pid,
      status: ServiceStatus.KILLED,
    });

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkBotHook() {
    const hasRisk = await this.botHookService.hasRisky();

    if (hasRisk) {
      await this.botHookService.stop();
    }
  }
}

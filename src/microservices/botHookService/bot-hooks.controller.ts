import { Controller, Inject, OnApplicationBootstrap } from '@nestjs/common';
import { ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';

import { ServiceStatus } from 'src/types';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { LogsService } from 'src/global/logs.service';
import { BotHooksService } from './bot-hooks.service';
import { TaskExecutorService } from '../apiService/modules/task-executor/task-executor.service';

@Controller()
export class BotHooksController implements OnApplicationBootstrap {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private readonly botHookService: BotHooksService,
    private readonly taskExecutorService: TaskExecutorService,
    private readonly logger: LogsService,
  ) {}

  async onApplicationBootstrap() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.BOT_HOOKS_SERVICE,
      pid: process.pid,
      status: ServiceStatus.READY,
    });
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

    this.botHookService.destroyUnwatch();

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

  @Cron(CronExpression.EVERY_MINUTE)
  async setupBotHooks() {
    await this.botHookService.setupHookHandlers();
  }

  @Cron(CronExpression.EVERY_SECOND)
  async executeCronForTaskExecutor() {
    if (this.taskExecutorService.status !== ServiceStatus.READY) {
      return;
    }

    await this.taskExecutorService.performAvailableTasks(true);
  }
}

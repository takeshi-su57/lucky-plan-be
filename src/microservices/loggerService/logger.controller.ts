import { Controller, Inject } from '@nestjs/common';
import {
  ClientProxy,
  EventPattern,
  MessagePattern,
  Payload,
} from '@nestjs/microservices';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

import { LogsService } from './logger.service';
import { CreateLogInput } from '../apiService/loggers/dto/log.dto';
import { ServiceStatus } from 'src/types';

@Controller()
export class LoggerController {
  constructor(
    private readonly logService: LogsService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
  ) {}

  @EventPattern(PATTERNS.killProcessEvent)
  async killProcess() {
    await this.client.emit(PATTERNS.ProcessStatus, {
      service: SERVICE_NAMES.LOGGER_SERVICE,
      status: ServiceStatus.KILLED,
    });

    setTimeout(() => {
      process.exit(0);
    }, 10_000);
  }

  @MessagePattern(PATTERNS.LoggerService.NativeLogMsg)
  async nativeLog(@Payload() payload: CreateLogInput) {
    return this.logService.nativeLog(payload);
  }

  @MessagePattern(PATTERNS.LoggerService.LogMsg)
  async log(@Payload() payload: CreateLogInput) {
    return this.logService.log(payload);
  }
}

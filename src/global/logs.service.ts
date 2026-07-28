import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { CreateLogInput } from '../microservices/apiService/modules/loggers/dto/log.dto';

@Injectable()
export class LogsService {
  private readonly logger = new Logger(LogsService.name);
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
  ) {}

  async nativeLog(logInput: CreateLogInput) {
    this.emit(PATTERNS.Log.NativeLogEvent, logInput);
  }

  async log(createLogInput: CreateLogInput) {
    this.emit(PATTERNS.Log.LogEvent, createLogInput);
  }

  private withService(logInput: CreateLogInput): CreateLogInput {
    return {
      ...logInput,
      service:
        logInput.service ?? process.env.SERVICE ?? SERVICE_NAMES.API_SERVICE,
    };
  }

  private emit(pattern: string, logInput: CreateLogInput): void {
    this.redisClient.emit(pattern, this.withService(logInput)).subscribe({
      error: (error: unknown) => {
        this.logger.error(`Unable to publish log event: ${String(error)}`);
      },
    });
  }
}

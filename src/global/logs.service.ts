import { Inject, Injectable } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';
import { CreateLogInput } from '../microservices/apiService/modules/loggers/dto/log.dto';

@Injectable()
export class LogsService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
  ) {}

  nativeLog(logInput: CreateLogInput) {
    this.redisClient.emit(PATTERNS.Log.NativeLogEvent, logInput);
  }

  async log(createLogInput: CreateLogInput): Promise<void> {
    this.redisClient.emit(PATTERNS.Log.LogEvent, createLogInput);
  }
}

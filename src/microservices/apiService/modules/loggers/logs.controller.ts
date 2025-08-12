import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

import { PATTERNS } from 'src/utils/constants';

import { LogsService } from './logs.service';
import { CreateLogInput } from './dto/log.dto';

@Controller()
export class LogsController {
  constructor(private readonly logService: LogsService) {}

  @EventPattern(PATTERNS.Log.NativeLogEvent)
  async nativeLog(@Payload() payload: CreateLogInput) {
    await this.logService.nativeLog(payload);
  }

  @EventPattern(PATTERNS.Log.LogEvent)
  async log(@Payload() payload: CreateLogInput) {
    await this.logService.log(payload);
  }
}

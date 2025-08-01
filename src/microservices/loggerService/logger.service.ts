import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

import { PrismaService } from 'src/global/prisma.service';

import { CreateLogInput } from '../apiService/loggers/dto/log.dto';

import { PATTERNS, SERVICE_NAMES } from 'src/utils/constants';

@Injectable()
export class LogsService {
  constructor(
    private prismaService: PrismaService,
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private client: ClientProxy,
    private logger: Logger,
  ) {}

  nativeLog(logInput: CreateLogInput) {
    switch (logInput.severity) {
      case 'Info': {
        this.logger.log(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Error': {
        this.logger.error(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Warning': {
        this.logger.warn(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Emergency': {
        this.logger.error(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Critical': {
        this.logger.error(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Alert': {
        this.logger.warn(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Debug': {
        this.logger.debug(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Notice': {
        this.logger.log(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      default: {
        this.logger.log(`${logInput.summary} : ${logInput.details || ''}`);
      }
    }
  }

  async log(createLogInput: CreateLogInput): Promise<void> {
    this.nativeLog(createLogInput);

    const log = await this.prismaService.log.create({
      data: createLogInput,
    });

    this.client.emit(PATTERNS.LoggerService.NewLogEvent, log);
  }
}

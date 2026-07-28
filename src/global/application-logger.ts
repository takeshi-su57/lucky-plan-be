import { LoggerService } from '@nestjs/common';
import { join, resolve } from 'node:path';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { utilities as nestWinstonUtilities, WinstonModule } from 'nest-winston';

import { redactLogText } from './log-redaction';

export function createApplicationLogger(service: string): LoggerService {
  const directory = resolve(
    process.env.LOG_DIRECTORY ?? join(process.cwd(), 'logs'),
  );
  const safeService = service.replace(/[^a-zA-Z0-9_-]/g, '-');
  const redact = winston.format((info) => {
    if (typeof info.message === 'string')
      info.message = redactLogText(info.message);
    return info;
  });
  const consoleFormat = nestWinstonUtilities.format.nestLike(service, {
    colors: true,
    prettyPrint: true,
    processId: true,
    appName: true,
  });

  return WinstonModule.createLogger({
    level: 'debug',
    defaultMeta: { service },
    format: winston.format.combine(redact(), winston.format.timestamp()),
    transports: [
      new DailyRotateFile({
        dirname: directory,
        filename: `${safeService}-%DATE%.jsonl`,
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxFiles: '30d',
        level: 'debug',
        auditFile: join(directory, `.${safeService}-log-audit.json`),
        format: winston.format.json(),
      }),
      new winston.transports.Console({
        level: 'debug',
        format: consoleFormat,
      }),
    ],
  });
}

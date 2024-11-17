import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import {
  WinstonModule,
  utilities as nestWinstonModuleUtilities,
} from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';

import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: WinstonModule.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.ms(),
        nestWinstonModuleUtilities.format.nestLike('Lucky Plan', {
          colors: true,
          prettyPrint: true,
          processId: true,
          appName: true,
        }),
      ),
      transports: [
        new winston.transports.DailyRotateFile({
          filename: 'logs/application-%DATE%.log', // File path format
          datePattern: 'YYYY-MM-DD', // Create a new file daily
          maxSize: '20m', // Optional max file size
        }),
        new winston.transports.Console(), // Optional: log to console as well
      ],
    }),
  });

  app.useGlobalPipes(new ValidationPipe());

  await app.listen(3000);
}
bootstrap();

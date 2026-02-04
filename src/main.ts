import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NestExpressApplication } from '@nestjs/platform-express';

import { SERVICE_NAMES } from './utils/constants';

import { ApiModule } from './microservices/apiService/api.module';
import { LeaderboardModule } from './microservices/leaderboardService/leaderboard.module';
import { TradingModule } from './microservices/tradingService/trading.module';
import { BotHooksModule } from './microservices/botHookService/bot-hooks.module';
import { JupPerpEventLoggerModule } from './microservices/jupPerpEventLoggerService/jup-perp-event-logger.module';
import { SnapshotModule } from './microservices/snapshotService/snapshot.module';

import 'dotenv';

async function bootstrap() {
  switch (process.env.SERVICE) {
    case SERVICE_NAMES.LEADERBOARD_SERVICE: {
      const app = await NestFactory.createMicroservice<MicroserviceOptions>(
        LeaderboardModule,
        {
          transport: Transport.REDIS,
          options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            retryAttempts: Number.MAX_SAFE_INTEGER,
            retryDelay: 1000,
          },
        },
      );

      await app.listen();
      break;
    }
    case SERVICE_NAMES.SNAPSHOT_SERVICE: {
      const app = await NestFactory.createMicroservice<MicroserviceOptions>(
        SnapshotModule,
        {
          transport: Transport.REDIS,
          options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            retryAttempts: Number.MAX_SAFE_INTEGER,
            retryDelay: 1000,
          },
        },
      );

      await app.listen();
      break;
    }
    case SERVICE_NAMES.TRADING_SERVICE: {
      const app = await NestFactory.createMicroservice<MicroserviceOptions>(
        TradingModule,
        {
          transport: Transport.REDIS,
          options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            retryAttempts: Number.MAX_SAFE_INTEGER,
            retryDelay: 1000,
          },
        },
      );

      await app.listen();
      break;
    }
    case SERVICE_NAMES.BOT_HOOKS_SERVICE: {
      const app = await NestFactory.createMicroservice<MicroserviceOptions>(
        BotHooksModule,
        {
          transport: Transport.REDIS,
          options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            retryAttempts: Number.MAX_SAFE_INTEGER,
            retryDelay: 1000,
          },
        },
      );

      await app.listen();
      break;
    }
    case SERVICE_NAMES.JUP_PERP_EVENT_LOGGER_SERVICE: {
      const app = await NestFactory.createMicroservice<MicroserviceOptions>(
        JupPerpEventLoggerModule,
        {
          transport: Transport.REDIS,
          options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            retryAttempts: Number.MAX_SAFE_INTEGER,
            retryDelay: 1000,
          },
        },
      );

      await app.listen();
      break;
    }
    case SERVICE_NAMES.API_SERVICE: {
      const app = await NestFactory.create<NestExpressApplication>(ApiModule);

      // Increase body size limit for large optimizer payloads (Pareto front results)
      app.useBodyParser('json', { limit: '50mb' });

      app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.REDIS,
        options: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          retryAttempts: Number.MAX_SAFE_INTEGER,
          retryDelay: 1000,
        },
      });

      app.set('query parser', 'extended');

      app.useGlobalPipes(new ValidationPipe());
      app.enableCors();

      await app.startAllMicroservices();

      await app.listen(process.env.PORT || 3000);

      break;
    }
    default: {
      console.log('Invalid service');
      process.exit(1);
    }
  }
}
bootstrap();

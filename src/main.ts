import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';

import { SERVICE_NAMES } from './utils/constants';

import { ApiModule } from './microservices/apiService/api.module';
import { LeaderboardModule } from './microservices/leaderboardService/leaderboard.module';
import { TradingModule } from './microservices/tradingService/trading.module';

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

      app.use(
        compression({
          threshold: '1kb',
          filter: (req, res) => {
            if (req.headers.upgrade?.toLowerCase() === 'websocket') {
              return false;
            }

            return compression.filter(req, res);
          },
        }),
      );

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

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';

import { SERVICE_NAMES } from './utils/constants';

import { ApiModule } from './microservices/apiService/api.module';
import { LeaderboardModule } from './microservices/leaderboardService/leaderboard.module';
import { TradingModule } from './microservices/tradingService/trading.module';
import { Web3Module } from './microservices/web3Service/web3.module';

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
    case SERVICE_NAMES.WEB3_SERVICE: {
      const app = await NestFactory.createMicroservice<MicroserviceOptions>(
        Web3Module,
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
      const app = await NestFactory.create(ApiModule);

      app.connectMicroservice<MicroserviceOptions>({
        transport: Transport.REDIS,
        options: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          retryAttempts: Number.MAX_SAFE_INTEGER,
          retryDelay: 1000,
        },
      });

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

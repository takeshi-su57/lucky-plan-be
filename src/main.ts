import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';

import { SERVICE_NAMES } from './utils/constants';
import { createApplicationLogger } from './global/application-logger';

import { ApiModule } from './microservices/apiService/api.module';
import { AnalyticsModule } from './microservices/analyticsService/analytics.module';
import { CopyTradingModule } from './microservices/copyTradingService/copy-trading.module';
import { SimulationEvaluatorWorkerModule } from './microservices/simulationEvaluatorWorker/simulation-evaluator-worker.module';

import 'dotenv';

async function bootstrap() {
  const service = process.env.SERVICE ?? 'UNKNOWN_SERVICE';
  const applicationLogger = createApplicationLogger(service);
  Logger.overrideLogger(applicationLogger);
  redirectConsole(service);

  switch (service) {
    case SERVICE_NAMES.ANALYTICS_SERVICE: {
      const app = await NestFactory.createMicroservice<MicroserviceOptions>(
        AnalyticsModule,
        {
          transport: Transport.REDIS,
          options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            retryAttempts: Number.MAX_SAFE_INTEGER,
            retryDelay: 1000,
          },
          logger: applicationLogger,
        },
      );

      await app.listen();
      break;
    }
    case SERVICE_NAMES.COPY_TRADING_SERVICE: {
      const app = await NestFactory.createMicroservice<MicroserviceOptions>(
        CopyTradingModule,
        {
          transport: Transport.REDIS,
          options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            retryAttempts: Number.MAX_SAFE_INTEGER,
            retryDelay: 1000,
          },
          logger: applicationLogger,
        },
      );

      await app.listen();
      break;
    }
    case SERVICE_NAMES.SIMULATION_EVALUATOR_WORKER_SERVICE: {
      await NestFactory.createApplicationContext(
        SimulationEvaluatorWorkerModule,
        {
          logger: applicationLogger,
        },
      );
      break;
    }
    case SERVICE_NAMES.API_SERVICE: {
      const app = await NestFactory.create<NestExpressApplication>(ApiModule, {
        logger: applicationLogger,
      });

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
            if (res.getHeader('Content-Type') === 'application/zip') {
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

function redirectConsole(context: string): void {
  const message = (args: unknown[]) =>
    args
      .map((value) =>
        value instanceof Error
          ? (value.stack ?? value.message)
          : typeof value === 'string'
            ? value
            : JSON.stringify(value),
      )
      .join(' ');
  console.log = (...args: unknown[]) => Logger.log(message(args), context);
  console.warn = (...args: unknown[]) => Logger.warn(message(args), context);
  console.error = (...args: unknown[]) =>
    Logger.error(message(args), undefined, context);
  console.debug = (...args: unknown[]) => Logger.debug(message(args), context);
}

bootstrap();

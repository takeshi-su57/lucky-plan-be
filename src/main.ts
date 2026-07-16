import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';

import { SERVICE_NAMES } from './utils/constants';

import { ApiModule } from './microservices/apiService/api.module';
import { AnalyticsModule } from './microservices/analyticsService/analytics.module';
import { CopyTradingModule } from './microservices/copyTradingService/copy-trading.module';
import { SimulationEvaluatorWorkerModule } from './microservices/simulationEvaluatorWorker/simulation-evaluator-worker.module';

import 'dotenv';

async function bootstrap() {
  switch (process.env.SERVICE) {
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
        },
      );

      await app.listen();
      break;
    }
    case SERVICE_NAMES.SIMULATION_EVALUATOR_WORKER_SERVICE: {
      await NestFactory.createApplicationContext(
        SimulationEvaluatorWorkerModule,
      );
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
bootstrap();

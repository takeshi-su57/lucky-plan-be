import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

import { GlobalModule } from '../../global/global.module';

import { LoggerController } from './logger.controller';
import { LogsService } from './logger.service';

import { SERVICE_NAMES } from 'src/utils/constants';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ClientsModule.register([
      {
        name: SERVICE_NAMES.REDIS_SERVICE,
        transport: Transport.REDIS,
        options: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
        },
      },
    ]),
    GlobalModule,
  ],
  controllers: [LoggerController],
  providers: [LogsService],
})
export class LeaderboardModule {}

import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PubSub } from 'graphql-subscriptions';

import { SERVICE_NAMES } from 'src/utils/constants';

import { PrismaService } from './prisma.service';
import { SecurityService } from './security.service';
import { LogsService } from './logs.service';

import { GnsV9Service } from './gnsV9.service';
import { Web3Service } from './web3.service';

export const PUB_SUB = Symbol('PUB_SUB');

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ClientsModule.register({
      clients: [
        {
          name: SERVICE_NAMES.REDIS_SERVICE,
          transport: Transport.REDIS,
          options: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
          },
        },
      ],
      isGlobal: true,
    }),
  ],
  providers: [
    PrismaService,
    Logger,
    SecurityService,
    LogsService,
    {
      provide: PUB_SUB,
      useValue: new PubSub(),
    },
    GnsV9Service,
    Web3Service,
  ],
  exports: [
    PrismaService,
    Logger,
    SecurityService,
    PUB_SUB,
    LogsService,
    GnsV9Service,
    Web3Service,
  ],
})
export class GlobalModule {}

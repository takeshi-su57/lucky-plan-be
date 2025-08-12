import { Module, Global, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PubSub } from 'graphql-subscriptions';
import { Scalar, CustomScalar } from '@nestjs/graphql';
import { Kind, ValueNode } from 'graphql';

import { SERVICE_NAMES } from 'src/utils/constants';

import { PrismaService } from './prisma.service';
import { SecurityService } from './security.service';
import { LogsService } from './logs.service';

import { GnsV9Service } from './gnsV9.service';
import { GnsV10Service } from './gnsV10.service';
import { Web3Service } from './web3.service';

export const PUB_SUB = Symbol('PUB_SUB');

@Scalar('Date', () => Date)
export class DateScalar
  implements CustomScalar<number | string | Date | null, Date | null>
{
  description = 'Date custom scalar type';

  parseValue(value: unknown): Date | null {
    if (typeof value === 'number') {
      return new Date(value);
    }

    if (typeof value === 'string') {
      return new Date(value);
    }

    if (value instanceof Date) {
      return value;
    }

    return null;
  }

  serialize(value: unknown): string | null {
    if (typeof value === 'number') {
      return new Date(value).toISOString();
    }

    if (typeof value === 'string') {
      return new Date(value).toISOString();
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return null;
  }

  parseLiteral(ast: ValueNode): Date | null {
    if (ast.kind === Kind.INT) {
      return new Date(ast.value);
    }

    if (ast.kind === Kind.STRING) {
      return new Date(ast.value);
    }

    return null;
  }
}

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
    GnsV10Service,
    Web3Service,
    DateScalar,
  ],
  exports: [
    PrismaService,
    Logger,
    SecurityService,
    PUB_SUB,
    LogsService,
    GnsV9Service,
    GnsV10Service,
    Web3Service,
    DateScalar,
  ],
})
export class GlobalModule {}

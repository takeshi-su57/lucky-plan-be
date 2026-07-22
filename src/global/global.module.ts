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
import { SimulationWorkflowConfigService } from './simulation-workflow-config.service';

export const PUB_SUB = Symbol('PUB_SUB');

@Scalar('Date', () => Date)
export class DateScalar implements CustomScalar<
  number | string | Date | null,
  Date | null
> {
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

@Scalar('JSON')
export class JSONScalar implements CustomScalar<
  number | string | Record<string, unknown> | null,
  Record<string, unknown> | null
> {
  description = 'JSON custom scalar type';

  parseValue(value: unknown): Record<string, unknown> | null {
    if (typeof value === 'number') {
      return JSON.parse(value.toString());
    }

    if (typeof value === 'string') {
      return JSON.parse(value.toString());
    }

    if (typeof value === 'object' && value !== null) {
      return JSON.parse(JSON.stringify(value));
    }

    return null;
  }

  serialize(value: unknown): string | null {
    if (typeof value === 'number') {
      return JSON.stringify(value);
    }

    if (typeof value === 'string') {
      return JSON.stringify(value);
    }

    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value);
    }

    return null;
  }

  parseLiteral(ast: ValueNode): Record<string, unknown> | null {
    if (ast.kind === Kind.INT) {
      return JSON.parse(ast.value.toString());
    }

    if (ast.kind === Kind.STRING) {
      return JSON.parse(ast.value.toString());
    }

    if (ast.kind === Kind.OBJECT) {
      return JSON.parse(JSON.stringify(ast.fields.map((field) => field.value)));
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
            retryAttempts: Number.MAX_SAFE_INTEGER,
            retryDelay: 1000,
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
    SimulationWorkflowConfigService,
    {
      provide: PUB_SUB,
      useValue: new PubSub(),
    },
    DateScalar,
    JSONScalar,
  ],
  exports: [
    PrismaService,
    Logger,
    SecurityService,
    PUB_SUB,
    LogsService,
    SimulationWorkflowConfigService,
    DateScalar,
    JSONScalar,
  ],
})
export class GlobalModule {}

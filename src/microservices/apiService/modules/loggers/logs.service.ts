import { Injectable, Inject, Logger } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { LogSeverity } from '@prisma/client';

import { PrismaService } from 'src/global/prisma.service';
import { LogsConnection, SeverityCount } from './entities/log.entity';
import { SUBSCRIPTION_TOKEN } from 'src/utils/constants';
import { CreateLogInput } from './dto/log.dto';

import { PUB_SUB } from 'src/global/global.module';

@Injectable()
export class LogsService {
  constructor(
    private prismaService: PrismaService,
    @Inject(PUB_SUB) private readonly pubSub: PubSub,
    private logger: Logger,
  ) {}

  nativeLog(logInput: CreateLogInput) {
    switch (logInput.severity) {
      case 'Info': {
        this.logger.log(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Error': {
        this.logger.error(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Warning': {
        this.logger.warn(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Emergency': {
        this.logger.error(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Critical': {
        this.logger.error(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Alert': {
        this.logger.warn(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Debug': {
        this.logger.debug(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      case 'Notice': {
        this.logger.log(`${logInput.summary} : ${logInput.details || ''}`);
        break;
      }
      default: {
        this.logger.log(`${logInput.summary} : ${logInput.details || ''}`);
      }
    }
  }

  async log(createLogInput: CreateLogInput): Promise<void> {
    this.nativeLog(createLogInput);

    const log = await this.prismaService.log.create({
      data: createLogInput,
    });

    this.pubSub.publish(SUBSCRIPTION_TOKEN.newLog, {
      [SUBSCRIPTION_TOKEN.newLog]: log,
    });
  }

  async check(id: number) {
    await this.prismaService.log.update({
      where: { id },
      data: {
        checked: true,
      },
    });
  }

  async getSeverityCounts(): Promise<SeverityCount[]> {
    const result = await this.prismaService.log.groupBy({
      by: ['severity'],
      where: {
        checked: false,
      },
      _count: true,
    });

    return result.map((item) => ({
      severity: item.severity,
      counts: item._count,
    }));
  }

  async allLogs(
    severity: LogSeverity | null,
    checked: boolean,
    first: number,
    after: number | null,
  ): Promise<LogsConnection> {
    const records = await this.prismaService.log.findMany({
      skip: after ? 1 : undefined,
      take: first,
      cursor: after
        ? {
            id: after,
          }
        : undefined,
      where: { ...(severity ? { severity } : {}), checked },
      orderBy: { timestamp: 'desc' },
    });

    const edges = records.map((record) => ({
      cursor: record.id,
      node: record,
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage: edges.length > 0,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
    };
  }
}

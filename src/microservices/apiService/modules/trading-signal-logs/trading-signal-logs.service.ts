import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  PerpTradingEventLog,
  TradingSignalLog as PrismaTradingSignalLog,
  Platform,
  Contract,
} from '@prisma/client';

import { PrismaService } from 'src/global/prisma.service';

import {
  TradingSignalLog,
  TradingSignalLogUpdated,
} from './entities/trading-signal-logs.entity';

import { LogsService } from 'src/global/logs.service';
import { getReadableError } from 'src/utils';
import { getWeb3Info } from 'src/web3/utils';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
} from '../trade-histories/entities/event-logs.entity';
import { SERVICE_NAMES, PATTERNS } from 'src/utils/constants';

@Injectable()
export class TradingSignalLogsService {
  constructor(
    @Inject(SERVICE_NAMES.REDIS_SERVICE) private redisClient: ClientProxy,
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {}

  async register(
    platform: Platform,
    address: string,
  ): Promise<TradingSignalLog> {
    const perpLogs = await this.prismaService.perpTradingEventLog.findMany({
      where: {
        address: address.toLowerCase(),
        platform,
      },
      orderBy: [
        {
          date: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    });

    const contracts = await this.prismaService.contract.findMany();

    const contractsMap = new Map<number, Contract>();

    contracts.forEach((contract) => {
      contractsMap.set(contract.id, contract);
    });

    const tradeHistories = perpLogs
      .map((log) => {
        const contract = contractsMap.get(log.contractId);

        if (!contract) {
          return null;
        }

        const web3Info = getWeb3Info(contract.platform, contract.version);

        const history = web3Info.eventToPerpTradeHistory(
          contract.chainId,
          JSON.parse(log.jsonLog),
        );

        if (!history) {
          return null;
        }

        return {
          eventLog: log,
          ...history,
        };
      })
      .filter((item) => item !== null);

    const groupedByPositionKey: Record<
      string,
      (PerpTradeHistory & { eventLog: PerpTradingEventLog })[]
    > = {};

    tradeHistories.forEach((item) => {
      if (groupedByPositionKey[item.positionKey]) {
        groupedByPositionKey[item.positionKey].push(item);
      } else {
        groupedByPositionKey[item.positionKey] = [item];
      }
    });

    const eventLogs: PerpTradingEventLog[] = [];

    for (const histories of Object.values(groupedByPositionKey)) {
      for (let i = 0; i < histories.length; i++) {
        const item = histories[i];

        if (item.operation !== PerpTradeHistoryOperation.OPEN) {
          continue;
        }

        const tempHistories: (PerpTradeHistory & {
          eventLog: PerpTradingEventLog;
        })[] = [];

        let hasCloseAction = false;

        for (let j = i; j < histories.length; j++) {
          const nextItem = histories[j];

          tempHistories.push(nextItem);

          if (nextItem.operation === PerpTradeHistoryOperation.CLOSE) {
            hasCloseAction = true;
            break;
          }
        }

        if (!hasCloseAction) {
          eventLogs.push(...tempHistories.map((item) => item.eventLog));
        }
      }
    }

    const entity = await this.prismaService.tradingSignalLog.upsert({
      where: {
        platform_address: {
          platform,
          address,
        },
      },
      create: {
        platform,
        address,
        eventLogIds: eventLogs.map((item) => item.id),
      },
      update: {
        eventLogIds: {
          set: eventLogs.map((item) => item.id),
        },
      },
    });

    return {
      ...entity,
      eventLogs,
    };
  }

  async unregister(signalId: number): Promise<boolean> {
    try {
      await this.prismaService.tradingSignalLog.delete({
        where: {
          id: signalId,
        },
      });

      return true;
    } catch (error) {
      this.logger.log({
        severity: 'Error',
        summary: `TradingSignalLogsService>unregister signalId: ${signalId}`,
        details: getReadableError(error),
      });

      return false;
    }
  }

  async removeEventLogs(
    signalId: number,
    eventLogIds: number[],
  ): Promise<TradingSignalLog> {
    const entity = await this.prismaService.tradingSignalLog.findUnique({
      where: {
        id: signalId,
      },
    });

    if (!entity) {
      throw new NotFoundException('Trading signal log not found');
    }

    const newEventLogIds = entity.eventLogIds.filter(
      (id) => !eventLogIds.includes(id),
    );

    await this.prismaService.tradingSignalLog.update({
      where: {
        id: signalId,
      },
      data: {
        eventLogIds: {
          set: newEventLogIds,
        },
      },
    });

    return this.getById(signalId);
  }

  async getById(id: number): Promise<TradingSignalLog> {
    const entity = await this.prismaService.tradingSignalLog.findUnique({
      where: {
        id,
      },
    });

    if (!entity) {
      throw new NotFoundException('Trading signal log not found');
    }

    const eventLogs = await this.prismaService.perpTradingEventLog.findMany({
      where: {
        id: { in: entity.eventLogIds },
      },
    });

    return {
      ...entity,
      eventLogs,
    };
  }

  async getAll(): Promise<TradingSignalLog[]> {
    const entities = await this.prismaService.tradingSignalLog.findMany();

    const ids = entities.flatMap((entity) => entity.eventLogIds);

    const eventLogsMap: Record<number, PerpTradingEventLog> = {};

    const BATCH_SIZE = 100;

    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batchedIds = ids.slice(i, i + BATCH_SIZE);

      const logs = await this.prismaService.perpTradingEventLog.findMany({
        where: {
          id: { in: batchedIds },
        },
      });

      logs.forEach((log) => {
        eventLogsMap[log.id] = log;
      });
    }

    return entities.map((entity) => ({
      ...entity,
      eventLogs: entity.eventLogIds.map((id) => eventLogsMap[id]),
    }));
  }

  async handlePerpTradingEventLogs(
    platform: Platform,
    perpTradingEventLogs: PerpTradingEventLog[],
  ) {
    const signals = await this.prismaService.tradingSignalLog.findMany({
      where: {
        platform,
      },
    });

    const signalMap: Record<string, PrismaTradingSignalLog> = {};
    const updatedSignalsMap: Record<string, TradingSignalLogUpdated> = {};

    signals.forEach((signal) => {
      signalMap[`${signal.platform}-${signal.address.toLowerCase()}`] = signal;
    });

    perpTradingEventLogs.forEach((log) => {
      const entity = signalMap[`${log.platform}-${log.address.toLowerCase()}`];

      if (!entity) {
        return;
      }

      const updatedSignal =
        updatedSignalsMap[`${log.platform}-${log.address.toLowerCase()}`];

      if (updatedSignal) {
        updatedSignal.eventLogs.push(log);
      } else {
        updatedSignalsMap[`${log.platform}-${log.address.toLowerCase()}`] = {
          id: entity.id,
          eventLogs: [log],
        };
      }

      entity.eventLogIds.push(log.id);
    });

    const signalInputs = Object.values(signalMap).map((signal) => ({
      id: signal.id,
      eventLogIds: signal.eventLogIds,
    }));

    const updatedSignals = Object.values(updatedSignalsMap);

    if (updatedSignals.length > 0) {
      this.redisClient.emit(
        PATTERNS.TradingSignalLogs.TradingSignalLogUpdated,
        Object.values(updatedSignalsMap),
      );
    }

    if (signalInputs.length > 0) {
      await this.prismaService.$transaction(
        signalInputs.map((input) => {
          return this.prismaService.tradingSignalLog.update({
            where: {
              id: input.id,
            },
            data: {
              eventLogIds: {
                set: input.eventLogIds,
              },
            },
          });
        }),
      );
    }
  }
}

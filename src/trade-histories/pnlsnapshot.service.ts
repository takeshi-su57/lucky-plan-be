import { Injectable, Logger } from '@nestjs/common';
import { PnlSnapshot, PnlSnapshotKind, TradeHistory } from '@prisma/client';
import * as dayjs from 'dayjs';

import { PrismaService } from 'src/global/prisma.service';
import { getReadableError, getStartOfDay } from 'src/utils';
import {
  PnlSnapshotDetailsConnection,
  PnlSnapshotDetailsEdge,
} from './entities/trade-history.entity';

function getKeyFromHistory(history: TradeHistory, kind: PnlSnapshotKind) {
  return JSON.stringify({
    address: history.address.toLowerCase(),
    kind,
  });
}

function getKeyFromSnapshot(record: PnlSnapshot) {
  return JSON.stringify({
    address: record.address.toLowerCase(),
    kind: record.kind,
  });
}

function parseKey(key: string) {
  return JSON.parse(key) as {
    address: string;
    kind: PnlSnapshotKind;
  };
}

const timestampGapByPnlSnapshotKind = {
  [PnlSnapshotKind.DAY]: 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.TWO_DAY]: 2 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.THREE_DAY]: 3 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.WEEK]: 7 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.TWO_WEEK]: 2 * 7 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.MONTH]: 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.THREE_MONTH]: 3 * 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.HALF_YEAR]: 6 * 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.YEAR]: 365 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.ALL_TIME]: 10 * 365 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class PnlSnapshotsService {
  status: 'processing' | 'ready' = 'ready';

  constructor(
    private prismaService: PrismaService,
    private logger: Logger,
  ) {}

  async getPnlSnapshots(
    dateStr: string,
    contractId: number,
    kind: PnlSnapshotKind,
    first: number,
    after: number | null,
  ): Promise<PnlSnapshotDetailsConnection> {
    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        skip: after ? 1 : undefined,
        take: first,
        cursor: after
          ? {
              id: after,
            }
          : undefined,
        where: {
          dateStr,
          kind,
        },
        orderBy: {
          accUSDPnl: 'desc',
        },
      });

    const timestampGap = timestampGapByPnlSnapshotKind[kind];
    const startDate = new Date(
      getStartOfDay(new Date()).getTime() - timestampGap,
    );

    const historyRecords = await this.prismaService.tradeHistory.findMany({
      where: {
        OR: [
          ...pnlRecords.map((item) => ({
            address: item.address,
            contractId,
            date: {
              gt: startDate,
            },
          })),
        ],
      },
      orderBy: {
        block: 'asc',
      },
    });

    const historyRecordsMap = new Map<string, TradeHistory[]>();

    historyRecords.forEach((record) => {
      const arr = historyRecordsMap.get(record.address);

      if (arr) {
        arr.push(record);
      } else {
        historyRecordsMap.set(record.address, [record]);
      }
    });

    const edges: PnlSnapshotDetailsEdge[] = pnlRecords.map((record) => ({
      cursor: record.id,
      node: {
        ...record,
        histories: historyRecordsMap.get(record.address) || [],
      },
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage: edges.length > 0,
        endCursor: edges[edges.length - 1].cursor,
      },
    };
  }

  async getPnlSnapshotsByAddress(
    dateStr: string,
    address: string,
  ): Promise<PnlSnapshot[]> {
    return await this.prismaService.pnlSnapshot.findMany({
      where: {
        dateStr,
        address: address.toLowerCase(),
      },
    });
  }

  async buildSnapshots(endDate: Date) {
    this.status = 'processing';

    const startDate = getStartOfDay(new Date(endDate));
    const dateStr = dayjs(endDate).format('YYYY-MM-DD');

    await this.prismaService.pnlSnapshot.deleteMany({ where: { dateStr } });

    try {
      const BATCH_SIZE = 10000;

      let cursorId: number | null = null;

      while (true) {
        const records: TradeHistory[] = cursorId
          ? await this.prismaService.tradeHistory.findMany({
              skip: 1,
              take: BATCH_SIZE,
              cursor: {
                id: cursorId,
              },
              orderBy: {
                block: 'asc',
              },
            })
          : await this.prismaService.tradeHistory.findMany({
              take: BATCH_SIZE,
              orderBy: {
                block: 'asc',
              },
            });

        if (records.length === 0) {
          break;
        }

        const pnlSnapshotMap = new Map<string, number>();

        for (const record of records) {
          for (const kind of Object.values(PnlSnapshotKind)) {
            const key = getKeyFromHistory(record, kind);

            const timestampGap = timestampGapByPnlSnapshotKind[kind];
            const prev = pnlSnapshotMap.get(key) || 0;

            if (startDate.getTime() - timestampGap < record.date.getTime()) {
              pnlSnapshotMap.set(key, prev + +record.pnl);
            }
          }
        }

        const pnlSnapshotKeys = Array.from(pnlSnapshotMap.keys());

        const pnlRecords = await this.prismaService.pnlSnapshot.findMany({
          where: {
            OR: [
              ...pnlSnapshotKeys.map((key) => {
                const { address, kind } = parseKey(key);

                return {
                  address: address.toLowerCase(),
                  kind,
                };
              }),
            ],
          },
        });

        const pnlRecordsMap = new Map<string, number>();

        pnlRecords.forEach((record) => {
          const key = getKeyFromSnapshot(record);

          pnlRecordsMap.set(key, record.accUSDPnl);
        });

        const upsertInputs = pnlSnapshotKeys.map((key) => {
          const accValue = pnlSnapshotMap.get(key) || 0;
          const prevValue = pnlRecordsMap.get(key) || 0;

          const { address, kind } = parseKey(key);

          return {
            address: address.toLowerCase(),
            kind,
            accUSDPnl: prevValue + accValue,
            dateStr,
          };
        });

        await this.prismaService.$transaction(
          upsertInputs.map((input) => {
            return this.prismaService.pnlSnapshot.upsert({
              where: {
                address_dateStr_kind: {
                  address: input.address.toLowerCase(),
                  dateStr,
                  kind: input.kind,
                },
              },
              update: {
                accUSDPnl: input.accUSDPnl,
              },
              create: input,
            });
          }),
        );

        cursorId = records[records.length - 1].id;
      }

      await this.prismaService.pnlSnapshotInitializedFlag.upsert({
        where: {
          dateStr,
        },
        update: {
          isInit: true,
        },
        create: {
          dateStr,
          isInit: true,
        },
      });
    } catch (err) {
      this.logger.error(
        `PnlSnapshotsService>intialBuild>: ${getReadableError(err)}`,
      );

      return false;
    }

    this.status = 'ready';

    return true;
  }

  async isPnlSnapshotInitialized(dateStr: string) {
    const result =
      await this.prismaService.pnlSnapshotInitializedFlag.findUnique({
        where: {
          dateStr,
        },
      });

    if (!result) {
      return false;
    }

    return result.isInit;
  }

  async getAllPnlSnapshotInitializedFlag() {
    return await this.prismaService.pnlSnapshotInitializedFlag.findMany({
      orderBy: {
        dateStr: 'desc',
      },
    });
  }
}

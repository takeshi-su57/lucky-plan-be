import { Injectable, Logger } from '@nestjs/common';
import { PnlSnapshot, PnlSnapshotKind, TradeHistory } from '@prisma/client';
import { PrismaService } from 'src/global/prisma.service';
import { getReadableError } from 'src/utils';
import {
  PnlSnapshotDetailsConnection,
  PnlSnapshotDetailsEdge,
} from './entities/trade-history.entity';

function getKeyFromHistory(history: TradeHistory, kind: PnlSnapshotKind) {
  return JSON.stringify({
    address: history.address,
    contractId: history.contractId,
    kind,
  });
}

function getKeyFromSnapshot(record: PnlSnapshot) {
  return JSON.stringify({
    address: record.address,
    contractId: record.contractId,
    kind: record.kind,
  });
}

function parseKey(key: string) {
  return JSON.parse(key) as {
    address: string;
    contractId: number;
    kind: PnlSnapshotKind;
  };
}

const timestampGapByPnlSnapshotKind = {
  [PnlSnapshotKind.DAY]: 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.WEEK]: 7 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.TWO_WEEK]: 2 * 7 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.MONTH]: 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.TWO_MONTH]: 2 * 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.THREE_MONTH]: 3 * 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.HALF_YEAR]: 6 * 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.YEAR]: 365 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.TWO_YEAR]: 2 * 365 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.ALL_TIME]: 10 * 365 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class PnlSnapshotsService {
  status: 'initializing' | 'updating' | 'ready' = 'ready';

  constructor(
    private prismaService: PrismaService,
    private logger: Logger,
  ) {}

  async getPnlSnapshots(
    contractId: number,
    kind: PnlSnapshotKind,
    first: number,
    after: number | null,
  ): Promise<PnlSnapshotDetailsConnection> {
    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        skip: 1,
        take: first,
        cursor: after
          ? {
              id: after,
            }
          : undefined,
        where: {
          contractId,
          kind,
        },
        orderBy: {
          accUSDPnl: 'desc',
        },
      });

    const historyRecords = await this.prismaService.tradeHistory.findMany({
      where: {
        OR: [
          ...pnlRecords.map((item) => ({
            address: item.address,
            contractId,
          })),
        ],
      },
      orderBy: {
        timestamp: 'asc',
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

  async initialBuild() {
    this.status = 'initializing';

    try {
      const BATCH_SIZE = 1000;
      const currentDate = new Date();

      let cursorId: number | null = null;

      while (true) {
        const records: TradeHistory[] = cursorId
          ? await this.prismaService.tradeHistory.findMany({
              skip: 1,
              take: BATCH_SIZE,
              cursor: {
                id: 1,
              },
              orderBy: {
                timestamp: 'asc',
              },
            })
          : await this.prismaService.tradeHistory.findMany({
              take: BATCH_SIZE,
              orderBy: {
                timestamp: 'asc',
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

            if (
              currentDate.getTime() - timestampGap <
              record.timestamp.getTime()
            ) {
              pnlSnapshotMap.set(key, prev + record.pnl);
            }
          }
        }

        const pnlSnapshotKeys = Array.from(pnlSnapshotMap.keys());

        const pnlRecords = await this.prismaService.pnlSnapshot.findMany({
          where: {
            OR: [
              ...pnlSnapshotKeys.map((key) => {
                const { address, contractId, kind } = parseKey(key);

                return {
                  address,
                  contractId,
                  kind,
                };
              }),
            ],
          },
        });

        const updateInputs = pnlRecords.map((record) => {
          const key = getKeyFromSnapshot(record);

          const accValue = pnlSnapshotMap.get(key) || 0;

          return {
            id: record.id,
            accUSDPnl: record.accUSDPnl + accValue,
          };
        });

        await this.prismaService.$transaction(
          updateInputs.map((input) => {
            return this.prismaService.pnlSnapshot.update({
              where: {
                id: input.id,
              },
              data: input,
            });
          }),
        );

        cursorId = records[records.length - 1].id;
      }

      await this.prismaService.metadata.upsert({
        where: {
          key: 'lastPnlSnapshotUpdatedTimestamp',
        },
        update: {
          value: JSON.stringify(currentDate.getTime()),
        },
        create: {
          key: 'lastPnlSnapshotUpdatedTimestamp',
          value: JSON.stringify(currentDate.getTime()),
        },
      });
    } catch (err) {
      this.logger.error(getReadableError(err));
    }

    this.status = 'ready';
  }

  async dayUpdate() {
    this.status = 'updating';

    try {
      const lastPnlSnapshotUpdatedTimestampRecord =
        await this.prismaService.metadata.findUnique({
          where: {
            key: 'lastPnlSnapshotUpdatedTimestamp',
          },
        });

      if (!lastPnlSnapshotUpdatedTimestampRecord) {
        throw new Error('Not initialized');
      }

      const lastPnlSnapshotUpdatedTimestamp = JSON.parse(
        lastPnlSnapshotUpdatedTimestampRecord.value,
      ) as number;

      const dayGap = 24 * 3600 * 1000;
      const lastUpdatedDate = new Date(lastPnlSnapshotUpdatedTimestamp);
      const newLastUpdatedDate = new Date(
        lastPnlSnapshotUpdatedTimestamp + dayGap,
      );

      const ranges: { startDate: Date; endDate: Date }[] = [];

      for (const kind of Object.values(PnlSnapshotKind)) {
        const timestampGap = timestampGapByPnlSnapshotKind[kind];

        const endDate = new Date(
          lastPnlSnapshotUpdatedTimestamp - timestampGap,
        );
        const startDate = new Date(endDate.getTime() - dayGap);

        ranges.push({ startDate, endDate });
      }

      const newRecords = await this.prismaService.tradeHistory.findMany({
        where: {
          OR: [
            ...ranges.map((range) => ({
              timestamp: {
                gt: range.startDate,
                lte: range.endDate,
              },
            })),
          ],
        },
      });

      const plusPnlSnapshotMap = new Map<string, number>();
      const minusPnlSnapshotMap = new Map<string, number>();

      const keySet = new Set<string>();

      for (const record of newRecords) {
        for (const kind of Object.values(PnlSnapshotKind)) {
          const key = getKeyFromHistory(record, kind);

          const timestampGap = timestampGapByPnlSnapshotKind[kind];

          const endDate = new Date(
            lastPnlSnapshotUpdatedTimestamp - timestampGap,
          );
          const startDate = new Date(endDate.getTime() - dayGap);

          if (
            record.timestamp <= newLastUpdatedDate &&
            record.timestamp > lastUpdatedDate
          ) {
            const prev = plusPnlSnapshotMap.get(key) || 0;

            plusPnlSnapshotMap.set(key, prev + record.pnl);

            keySet.add(key);
          } else if (
            startDate < record.timestamp &&
            record.timestamp <= endDate
          ) {
            const prev = minusPnlSnapshotMap.get(key) || 0;

            minusPnlSnapshotMap.set(key, prev + record.pnl);

            keySet.add(key);
          }
        }
      }

      const pnlSnapshotKeys = Array.from(keySet);

      const pnlRecords = await this.prismaService.pnlSnapshot.findMany({
        where: {
          OR: [
            ...pnlSnapshotKeys.map((key) => {
              const { address, contractId, kind } = parseKey(key);

              return {
                address,
                contractId,
                kind,
              };
            }),
          ],
        },
      });

      const updateInputs = pnlRecords.map((record) => {
        const key = getKeyFromSnapshot(record);

        return {
          id: record.id,
          accUSDPnl:
            record.accUSDPnl +
            (plusPnlSnapshotMap.get(key) || 0) -
            (minusPnlSnapshotMap.get(key) || 0),
        };
      });

      await this.prismaService.$transaction(
        updateInputs.map((input) => {
          return this.prismaService.pnlSnapshot.update({
            where: {
              id: input.id,
            },
            data: input,
          });
        }),
      );

      await this.prismaService.metadata.upsert({
        where: {
          key: 'lastPnlSnapshotUpdatedTimestamp',
        },
        update: {
          value: JSON.stringify(newLastUpdatedDate.getTime()),
        },
        create: {
          key: 'lastPnlSnapshotUpdatedTimestamp',
          value: JSON.stringify(newLastUpdatedDate.getTime()),
        },
      });
    } catch (err) {
      this.logger.error(getReadableError(err));
    }

    this.status = 'ready';
  }
}

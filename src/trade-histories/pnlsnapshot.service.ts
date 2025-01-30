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
    address: history.address.toLowerCase(),
    contractId: history.contractId,
    kind,
  });
}

function getKeyFromSnapshot(record: PnlSnapshot) {
  return JSON.stringify({
    address: record.address.toLowerCase(),
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
  [PnlSnapshotKind.TWO_DAY]: 2 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.THREE_DAY]: 3 * 24 * 60 * 60 * 1000,
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
        skip: after ? 1 : undefined,
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

    const timestampGap = timestampGapByPnlSnapshotKind[kind];
    const startDate = new Date(Date.now() - timestampGap);

    const historyRecords = await this.prismaService.tradeHistory.findMany({
      where: {
        OR: [
          ...pnlRecords.map((item) => ({
            address: item.address,
            contractId,
            timestamp: {
              gt: startDate,
            },
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

  async getPnlSnapshotsByAddress(
    contractId: number,
    address: string,
  ): Promise<PnlSnapshot[]> {
    return await this.prismaService.pnlSnapshot.findMany({
      where: {
        contractId,
        address: address.toLowerCase(),
      },
    });
  }

  async initialBuild() {
    this.status = 'initializing';

    await this.prismaService.pnlSnapshot.deleteMany({});

    try {
      const BATCH_SIZE = 10000;
      const currentDate = new Date();

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
                  address: address.toLowerCase(),
                  contractId,
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

          const { address, contractId, kind } = parseKey(key);

          return {
            address: address.toLowerCase(),
            contractId,
            kind,
            accUSDPnl: prevValue + accValue,
          };
        });

        await this.prismaService.$transaction(
          upsertInputs.map((input) => {
            return this.prismaService.pnlSnapshot.upsert({
              where: {
                address_contractId_kind: {
                  address: input.address.toLowerCase(),
                  contractId: input.contractId,
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
      this.logger.error(
        `PnlSnapshotsService>intialBuild>: ${getReadableError(err)}`,
      );

      return false;
    }

    this.status = 'ready';

    console.timeLog('InitStarted');

    return true;
  }

  async updatePnlSnapshot() {
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

      const lastUpdatedDate = new Date(lastPnlSnapshotUpdatedTimestamp);
      const newLastUpdatedDate = new Date();
      const gap =
        newLastUpdatedDate.getTime() - lastPnlSnapshotUpdatedTimestamp;

      const ranges: { startDate: Date; endDate: Date }[] = [
        { startDate: lastUpdatedDate, endDate: newLastUpdatedDate },
      ];

      for (const kind of Object.values(PnlSnapshotKind)) {
        const timestampGap = timestampGapByPnlSnapshotKind[kind];

        const endDate = new Date(
          lastPnlSnapshotUpdatedTimestamp - timestampGap,
        );
        const startDate = new Date(
          lastPnlSnapshotUpdatedTimestamp - timestampGap - gap,
        );

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
          const startDate = new Date(
            lastPnlSnapshotUpdatedTimestamp - timestampGap - gap,
          );

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
                address: address.toLowerCase(),
                contractId,
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
        const plusValue = plusPnlSnapshotMap.get(key) || 0;
        const minusValue = minusPnlSnapshotMap.get(key) || 0;

        const prevValue = pnlRecordsMap.get(key);

        const { address, contractId, kind } = parseKey(key);

        return {
          address: address.toLowerCase(),
          contractId,
          kind,
          accUSDPnl:
            prevValue !== undefined
              ? prevValue + plusValue - minusValue
              : plusValue,
        };
      });

      await this.prismaService.$transaction(
        upsertInputs.map((input) => {
          return this.prismaService.pnlSnapshot.upsert({
            where: {
              address_contractId_kind: {
                address: input.address.toLowerCase(),
                contractId: input.contractId,
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
      this.logger.error(
        `PnlSnapshotsService>dayUpdate>: ${getReadableError(err)}`,
      );
    }

    this.status = 'ready';
  }
}

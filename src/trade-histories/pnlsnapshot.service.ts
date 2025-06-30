import { Injectable } from '@nestjs/common';
import { PnlSnapshot, PnlSnapshotKind, TradeHistory } from '@prisma/client';
import * as dayjs from 'dayjs';

import { PrismaService } from 'src/global/prisma.service';
import { getReadableError, getStartOfDay } from 'src/utils';
import {
  PnlSnapshotDetailsConnection,
  PnlSnapshotDetailsEdge,
} from './entities/trade-history.entity';
import { LogsService } from 'src/loggers/logs.service';

function parseKey(key: string) {
  return JSON.parse(key) as {
    address: string;
    contractId: number;
    kind: PnlSnapshotKind;
  };
}

function getKey(address: string, kind: PnlSnapshotKind, contractId: number) {
  return JSON.stringify({
    address: address.toLowerCase(),
    contractId,
    kind,
  });
}

const timestampGapByPnlSnapshotKind = {
  [PnlSnapshotKind.DAY]: 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.WEEK]: 7 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.MONTH]: 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.THREE_MONTH]: 3 * 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.ALL_TIME]: 10 * 365 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class PnlSnapshotsService {
  status: 'processing' | 'ready' = 'ready';

  constructor(
    private prismaService: PrismaService,
    private logger: LogsService,
  ) {}

  async getPnlSnapshots(
    dateStr: string,
    contractId: number,
    kind: PnlSnapshotKind,
    first: number,
    after: number | null,
  ): Promise<PnlSnapshotDetailsConnection> {
    const pnlRecords: PnlSnapshot[] = after
      ? await this.prismaService.pnlSnapshot.findMany({
          skip: after ? 1 : undefined,
          take: first,
          cursor: {
            id: after,
          },
          where: {
            dateStr,
            kind,
            contractId,
            accUSDPnl: {
              not: 0,
            },
          },
          orderBy: {
            accUSDPnl: 'desc',
          },
        })
      : await this.prismaService.pnlSnapshot.findMany({
          take: first,
          where: {
            dateStr,
            kind,
            contractId,
            accUSDPnl: {
              not: 0,
            },
          },
          orderBy: {
            accUSDPnl: 'desc',
          },
        });

    const timestampGap = timestampGapByPnlSnapshotKind[kind];
    const startDate = new Date(
      getStartOfDay(new Date(dateStr)).getTime() - timestampGap,
    );

    const historyRecords = await this.prismaService.tradeHistory.findMany({
      where: {
        OR: [
          ...pnlRecords.map((item) => ({
            address: item.address,
            ...(contractId !== 0 ? { contractId } : {}),
            date: {
              gt: startDate,
            },
          })),
        ],
      },
      orderBy: [
        {
          date: 'asc',
        },
        {
          block: 'asc',
        },
      ],
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
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
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

  async dynamicSnapshotBuild(dateStr: string) {
    this.status = 'processing';

    const BATCH_SIZE = 1000;
    const lastDayStr = dayjs(dateStr).subtract(1, 'day').format('YYYY-MM-DD');

    try {
      const isInitialized = await this.isPnlSnapshotInitialized(lastDayStr);

      if (!isInitialized?.isInit) {
        this.status = 'ready';

        throw new Error('Pnl snapshot is not initialized');
      }

      const lowerBound = dayjs(dateStr).startOf('day').toDate().getTime();
      const upperBound = dayjs(dateStr).endOf('day').toDate().getTime();

      await this.prismaService.pnlSnapshot.deleteMany({ where: { dateStr } });

      const testContractIdsMap = new Map<number, boolean>();

      const testContracts = await this.prismaService.contract.findMany({
        where: {
          isTestnet: true,
        },
      });

      testContracts.forEach((contract) =>
        testContractIdsMap.set(contract.id, true),
      );

      let pnlSnapshotCursorId: number | null = null;

      // clone last day's pnl snapshot for dynamic snapshot build
      while (true) {
        const records: PnlSnapshot[] = pnlSnapshotCursorId
          ? await this.prismaService.pnlSnapshot.findMany({
              skip: 1,
              take: BATCH_SIZE,
              cursor: {
                id: pnlSnapshotCursorId,
              },
              where: {
                dateStr: lastDayStr,
              },
            })
          : await this.prismaService.pnlSnapshot.findMany({
              take: BATCH_SIZE,
              where: {
                dateStr: lastDayStr,
              },
            });

        if (records.length === 0) {
          break;
        }

        const upsertInputs = records.map((record) => {
          return {
            address: record.address,
            contractId: record.contractId,
            kind: record.kind,
            accUSDPnl: record.accUSDPnl,
            dateStr,
          };
        });

        await this.prismaService.pnlSnapshot.createMany({
          data: upsertInputs,
        });

        pnlSnapshotCursorId = records[records.length - 1].id;
      }

      for (const kind of Object.values(PnlSnapshotKind)) {
        let cursorId: number | null = null;

        const pastLowerBound = lowerBound - timestampGapByPnlSnapshotKind[kind];
        const pastUpperBound = upperBound - timestampGapByPnlSnapshotKind[kind];

        while (true) {
          const records: TradeHistory[] = cursorId
            ? await this.prismaService.tradeHistory.findMany({
                skip: 1,
                take: BATCH_SIZE,
                cursor: {
                  id: cursorId,
                },
                where: {
                  date: {
                    gte: new Date(pastLowerBound),
                    lte: new Date(pastUpperBound),
                  },
                },
                orderBy: [
                  {
                    date: 'asc',
                  },
                  {
                    block: 'asc',
                  },
                ],
              })
            : await this.prismaService.tradeHistory.findMany({
                take: BATCH_SIZE,
                where: {
                  date: {
                    gte: new Date(pastLowerBound),
                    lte: new Date(pastUpperBound),
                  },
                },
                orderBy: [
                  {
                    date: 'asc',
                  },
                  {
                    block: 'asc',
                  },
                ],
              });

          if (records.length === 0) {
            break;
          }

          const historiesUsdPnlMap = new Map<string, number>();

          for (const record of records) {
            const contractKey = getKey(record.address, kind, record.contractId);
            const overallKey = getKey(record.address, kind, 0);

            const prevContractValue = historiesUsdPnlMap.get(contractKey) || 0;
            const prevOverallValue = historiesUsdPnlMap.get(overallKey) || 0;

            historiesUsdPnlMap.set(
              contractKey,
              prevContractValue + +record.pnl * +record.collateralPriceUsd,
            );

            if (!testContractIdsMap.get(record.contractId)) {
              historiesUsdPnlMap.set(
                overallKey,
                prevOverallValue + +record.pnl * +record.collateralPriceUsd,
              );
            }
          }

          const historiesUsdPnlMapKeys = Array.from(historiesUsdPnlMap.keys());

          const pnlRecords = await this.prismaService.pnlSnapshot.findMany({
            where: {
              OR: [
                ...historiesUsdPnlMapKeys.map((key) => {
                  const { address, kind, contractId } = parseKey(key);

                  return {
                    dateStr,
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
            const key = getKey(record.address, record.kind, record.contractId);

            pnlRecordsMap.set(key, record.accUSDPnl);
          });

          const upsertInputs = historiesUsdPnlMapKeys.map((key) => {
            const { address, kind, contractId } = parseKey(key);

            const accValue = historiesUsdPnlMap.get(key) || 0;
            const prevValue = pnlRecordsMap.get(key) || 0;

            return {
              address: address.toLowerCase(),
              contractId,
              kind,
              accUSDPnl: prevValue - accValue,
              dateStr,
            };
          });

          await this.prismaService.$transaction(
            upsertInputs.map((input) => {
              return this.prismaService.pnlSnapshot.upsert({
                where: {
                  address_contractId_dateStr_kind: {
                    address: input.address.toLowerCase(),
                    dateStr: input.dateStr,
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
      }

      let currentCursorId: number | null = null;

      while (true) {
        const records: TradeHistory[] = currentCursorId
          ? await this.prismaService.tradeHistory.findMany({
              skip: 1,
              take: BATCH_SIZE,
              cursor: {
                id: currentCursorId,
              },
              where: {
                date: {
                  gte: new Date(lowerBound),
                  lte: new Date(upperBound),
                },
              },
              orderBy: [
                {
                  date: 'asc',
                },
                {
                  block: 'asc',
                },
              ],
            })
          : await this.prismaService.tradeHistory.findMany({
              take: BATCH_SIZE,
              where: {
                date: {
                  gte: new Date(lowerBound),
                  lte: new Date(upperBound),
                },
              },
              orderBy: [
                {
                  date: 'asc',
                },
                {
                  block: 'asc',
                },
              ],
            });

        if (records.length === 0) {
          break;
        }

        const historiesUsdPnlMap = new Map<string, number>();

        for (const record of records) {
          for (const kind of Object.values(PnlSnapshotKind)) {
            const contractKey = getKey(record.address, kind, record.contractId);
            const overallKey = getKey(record.address, kind, 0);

            const prevContractValue = historiesUsdPnlMap.get(contractKey) || 0;
            const prevOverallValue = historiesUsdPnlMap.get(overallKey) || 0;

            historiesUsdPnlMap.set(
              contractKey,
              prevContractValue + +record.pnl * +record.collateralPriceUsd,
            );

            if (!testContractIdsMap.get(record.contractId)) {
              historiesUsdPnlMap.set(
                overallKey,
                prevOverallValue + +record.pnl * +record.collateralPriceUsd,
              );
            }
          }
        }

        const historiesUsdPnlMapKeys = Array.from(historiesUsdPnlMap.keys());

        const pnlRecords = await this.prismaService.pnlSnapshot.findMany({
          where: {
            OR: [
              ...historiesUsdPnlMapKeys.map((key) => {
                const { address, kind, contractId } = parseKey(key);

                return {
                  dateStr,
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
          const key = getKey(record.address, record.kind, record.contractId);

          pnlRecordsMap.set(key, record.accUSDPnl);
        });

        const upsertInputs = historiesUsdPnlMapKeys.map((key) => {
          const { address, kind, contractId } = parseKey(key);

          const accValue = historiesUsdPnlMap.get(key) || 0;
          const prevValue = pnlRecordsMap.get(key) || 0;

          return {
            address: address.toLowerCase(),
            contractId,
            kind,
            accUSDPnl: prevValue + accValue,
            dateStr,
          };
        });

        await this.prismaService.$transaction(
          upsertInputs.map((input) => {
            return this.prismaService.pnlSnapshot.upsert({
              where: {
                address_contractId_dateStr_kind: {
                  address: input.address.toLowerCase(),
                  dateStr: input.dateStr,
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

        currentCursorId = records[records.length - 1].id;
      }

      const pnlSnapshotInitializedFlag =
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

      this.status = 'ready';

      return pnlSnapshotInitializedFlag;
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `PnlSnapshotsService>dynamicSnapshotBuild: LastDay: ${lastDayStr} CurrentDay: ${dateStr}`,
        details: getReadableError(err),
      });

      this.status = 'ready';
      return null;
    }
  }

  async buildSnapshots(dateStr: string, isForceBuild: boolean) {
    this.status = 'processing';

    try {
      if (!isForceBuild) {
        const isInitialized = await this.isPnlSnapshotInitialized(dateStr);

        if (isInitialized?.isInit) {
          this.status = 'ready';

          return isInitialized;
        }
      }

      const upperBound = dayjs(dateStr).endOf('day').toDate();

      const BATCH_SIZE = 1000;
      let cursorId: number | null = null;

      await this.prismaService.pnlSnapshot.deleteMany({ where: { dateStr } });

      const testContractIdsMap = new Map<number, boolean>();

      const testContracts = await this.prismaService.contract.findMany({
        where: {
          isTestnet: true,
        },
      });

      testContracts.forEach((contract) =>
        testContractIdsMap.set(contract.id, true),
      );

      while (true) {
        const records: TradeHistory[] = cursorId
          ? await this.prismaService.tradeHistory.findMany({
              skip: 1,
              take: BATCH_SIZE,
              cursor: {
                id: cursorId,
              },
              where: {
                date: {
                  lte: upperBound,
                },
              },
              orderBy: [
                {
                  date: 'asc',
                },
                {
                  block: 'asc',
                },
              ],
            })
          : await this.prismaService.tradeHistory.findMany({
              take: BATCH_SIZE,
              where: {
                date: {
                  lte: upperBound,
                },
              },
              orderBy: [
                {
                  date: 'asc',
                },
                {
                  block: 'asc',
                },
              ],
            });

        if (records.length === 0) {
          break;
        }

        const historiesUsdPnlMap = new Map<string, number>();

        for (const record of records) {
          for (const kind of Object.values(PnlSnapshotKind)) {
            const contractKey = getKey(record.address, kind, record.contractId);
            const overallKey = getKey(record.address, kind, 0);

            const timestampGap = timestampGapByPnlSnapshotKind[kind];
            const prevContractValue = historiesUsdPnlMap.get(contractKey) || 0;
            const prevOverallValue = historiesUsdPnlMap.get(overallKey) || 0;

            if (upperBound.getTime() - timestampGap < record.date.getTime()) {
              historiesUsdPnlMap.set(
                contractKey,
                prevContractValue + +record.pnl * +record.collateralPriceUsd,
              );

              if (!testContractIdsMap.get(record.contractId)) {
                historiesUsdPnlMap.set(
                  overallKey,
                  prevOverallValue + +record.pnl * +record.collateralPriceUsd,
                );
              }
            }
          }
        }

        const historiesUsdPnlMapKeys = Array.from(historiesUsdPnlMap.keys());

        const pnlRecords = await this.prismaService.pnlSnapshot.findMany({
          where: {
            OR: [
              ...historiesUsdPnlMapKeys.map((key) => {
                const { address, kind, contractId } = parseKey(key);

                return {
                  dateStr,
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
          const key = getKey(record.address, record.kind, record.contractId);

          pnlRecordsMap.set(key, record.accUSDPnl);
        });

        const upsertInputs = historiesUsdPnlMapKeys.map((key) => {
          const { address, kind, contractId } = parseKey(key);

          const accValue = historiesUsdPnlMap.get(key) || 0;
          const prevValue = pnlRecordsMap.get(key) || 0;

          return {
            address: address.toLowerCase(),
            contractId,
            kind,
            accUSDPnl: prevValue + accValue,
            dateStr,
          };
        });

        await this.prismaService.$transaction(
          upsertInputs.map((input) => {
            return this.prismaService.pnlSnapshot.upsert({
              where: {
                address_contractId_dateStr_kind: {
                  address: input.address.toLowerCase(),
                  dateStr: input.dateStr,
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

      const pnlSnapshotInitializedFlag =
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

      this.status = 'ready';

      return pnlSnapshotInitializedFlag;
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `PnlSnapshotsService>intialBuild`,
        details: getReadableError(err),
      });

      this.status = 'ready';
      return null;
    }
  }

  async initializePnlSnapshot(beginingDate: Date, isForceBuild: boolean) {
    if (isForceBuild) {
      await this.buildSnapshots(dayjs(beginingDate).format('YYYY-MM-DD'), true);
    }

    let startDate = dayjs(beginingDate).add(1, 'day').toDate();

    while (
      startDate.getTime() < dayjs(new Date()).endOf('day').toDate().getTime()
    ) {
      console.log(`Completed: ${dayjs(startDate).format('YYYY-MM-DD')}`);

      await this.dynamicSnapshotBuild(dayjs(startDate).format('YYYY-MM-DD'));
      startDate = dayjs(startDate).add(1, 'day').toDate();
    }

    return true;
  }

  async isPnlSnapshotInitialized(dateStr: string) {
    return await this.prismaService.pnlSnapshotInitializedFlag.findUnique({
      where: {
        dateStr,
      },
    });
  }

  async getAllPnlSnapshotInitializedFlag() {
    return await this.prismaService.pnlSnapshotInitializedFlag.findMany({
      orderBy: {
        dateStr: 'desc',
      },
    });
  }
}

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
  [PnlSnapshotKind.MONTH]: 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.ALL_TIME]: 10 * 365 * 24 * 60 * 60 * 1000,
};

const availableKinds = [PnlSnapshotKind.MONTH, PnlSnapshotKind.ALL_TIME];
const BATCH_SIZE = 10000;

@Injectable()
export class PnlSnapshotsService {
  status: 'processing' | 'ready' = 'ready';

  constructor(
    private prismaService: PrismaService,
    private logger: LogsService,
  ) {}

  async getPnlSnapshots(
    dateStr: string,
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
            contractId: 0,
            accUSDPnl: {
              not: 0,
            },
          },
          orderBy: [
            {
              accUSDPnl: 'desc',
            },
            { id: 'asc' },
          ],
        })
      : await this.prismaService.pnlSnapshot.findMany({
          take: first,
          where: {
            dateStr,
            kind,
            contractId: 0,
            accUSDPnl: {
              not: 0,
            },
          },
          orderBy: [
            {
              accUSDPnl: 'desc',
            },
            { id: 'asc' },
          ],
        });

    const timestampGap =
      timestampGapByPnlSnapshotKind[
        kind as keyof typeof timestampGapByPnlSnapshotKind
      ];
    const startDate = new Date(
      getStartOfDay(new Date(dateStr)).getTime() - timestampGap,
    );

    const historyRecords = await this.prismaService.tradeHistory.findMany({
      where: {
        OR: [
          ...pnlRecords.map((item) => ({
            address: item.address,
            contractId: {
              not: 4,
            },
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

  private async storeCacheToPnlsnapshot(
    dateStr: string,
    tempCache: Map<string, number>,
  ) {
    const storedKeys = Array.from(tempCache.keys());

    const startedTime = Date.now();

    for (let i = 0; i < storedKeys.length; i += BATCH_SIZE / 10) {
      const chunkTime = Date.now();

      const chunk = storedKeys.slice(i, i + BATCH_SIZE / 10);

      const pnlRecords = await this.prismaService.pnlSnapshot.findMany({
        where: {
          OR: [
            ...chunk.map((key) => {
              const { address, contractId, kind } = parseKey(key);

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

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsService>buildSnapshots`,
        details: `pnlRecords chunk ${i} ~ ${i + chunk.length} ${pnlRecords.length}`,
      });

      const pnlRecordsMap = new Map<string, number>();

      pnlRecords.forEach((record) => {
        const key = getKey(record.address, record.kind, record.contractId);

        pnlRecordsMap.set(key, record.accUSDPnl);
      });

      const upsertInputs = chunk.map((key) => {
        const { address, contractId, kind } = parseKey(key);

        const accValue = tempCache.get(key) || 0;
        const prevValue = pnlRecordsMap.get(key) || 0;

        return {
          address: address.toLowerCase(),
          contractId,
          kind,
          accUSDPnl: prevValue + accValue,
          dateStr,
        };
      });

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsService>buildSnapshots`,
        details: `upsertInputs chunk ${i} ~ ${i + chunk.length} ${upsertInputs.length}`,
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

      this.logger.nativeLog({
        severity: 'Debug',
        summary: 'Time for store cache',
        details: `${Date.now() - chunkTime}ms`,
      });
    }

    this.logger.nativeLog({
      severity: 'Debug',
      summary: 'Time for store cache',
      details: `${Date.now() - startedTime}ms`,
    });
  }

  async dynamicSnapshotBuild(dateStr: string) {
    this.status = 'processing';

    const lastDayStr = dayjs(dateStr).subtract(1, 'day').format('YYYY-MM-DD');

    console.log('it is a new version');

    this.logger.nativeLog({
      severity: 'Debug',
      summary: `PnlSnapshotsService>dynamicSnapshotBuild: ${dateStr} lastDayStr: ${lastDayStr}`,
    });

    try {
      const isInitialized = await this.isPnlSnapshotInitialized(lastDayStr);

      if (!isInitialized?.isInit) {
        this.status = 'ready';

        throw new Error('Pnl snapshot is not initialized');
      }

      const lowerBound = dayjs(dateStr).startOf('day').toDate().getTime();
      const upperBound = dayjs(dateStr).endOf('day').toDate().getTime();

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsService>dynamicSnapshotBuild: ${dateStr} lowerBound: ${lowerBound} upperBound: ${upperBound} gap: ${upperBound - lowerBound}`,
      });

      await this.prismaService.pnlSnapshot.deleteMany({ where: { dateStr } });

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsService>dynamicSnapshotBuild: ${dateStr}`,
        details: 'deleted many',
      });

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

      const cloneTime = Date.now();

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
              orderBy: [{ id: 'asc' }],
            })
          : await this.prismaService.pnlSnapshot.findMany({
              take: BATCH_SIZE,
              where: {
                dateStr: lastDayStr,
              },
              orderBy: [{ id: 'asc' }],
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

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsService>dynamicSnapshotBuild: ${dateStr}`,
        details: `clone last days pnl snapshot ${cloneTime - Date.now()}ms`,
      });

      const substractTime = Date.now();

      // substract pnl by outdated pnl snapshot
      for (const kind of availableKinds) {
        let cursorId: number | null = null;

        const pastLowerBound = lowerBound - timestampGapByPnlSnapshotKind[kind];
        const pastUpperBound = upperBound - timestampGapByPnlSnapshotKind[kind];

        const tempCache = new Map<string, number>();

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
                  { id: 'asc' },
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
                  { id: 'asc' },
                ],
              });

          if (records.length === 0) {
            break;
          }

          for (const record of records) {
            const contractKey = getKey(record.address, kind, record.contractId);
            const overallKey = getKey(record.address, kind, 0);

            const prevContractValue = tempCache.get(contractKey) || 0;
            const prevOverallValue = tempCache.get(overallKey) || 0;

            tempCache.set(
              contractKey,
              prevContractValue - +record.pnl * +record.collateralPriceUsd,
            );

            if (!testContractIdsMap.get(record.contractId)) {
              tempCache.set(
                overallKey,
                prevOverallValue - +record.pnl * +record.collateralPriceUsd,
              );
            }
          }

          const historiesPnlMapKeys = Array.from(tempCache.keys());

          if (historiesPnlMapKeys.length > 10_0000) {
            await this.storeCacheToPnlsnapshot(dateStr, tempCache);
            tempCache.clear();
          }

          cursorId = records[records.length - 1].id;
        }

        const cachedKeys = Array.from(tempCache.keys());

        if (cachedKeys.length > 0) {
          await this.storeCacheToPnlsnapshot(dateStr, tempCache);
          tempCache.clear();
        }
      }

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsService>dynamicSnapshotBuild: ${dateStr}`,
        details: `substract pnl by outdated pnl snapshot ${substractTime - Date.now()}ms`,
      });

      let currentCursorId: number | null = null;

      const tempCache = new Map<string, number>();

      while (true) {
        this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsService>dynamicSnapshotBuild: ${dateStr}`,
          details: `add pnl by perp trading event logs ${currentCursorId}`,
        });

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
                { id: 'asc' },
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
                { id: 'asc' },
              ],
            });

        if (records.length === 0) {
          break;
        }

        for (const record of records) {
          for (const kind of availableKinds) {
            const contractKey = getKey(record.address, kind, record.contractId);
            const overallKey = getKey(record.address, kind, 0);

            const prevContractValue = tempCache.get(contractKey) || 0;
            const prevOverallValue = tempCache.get(overallKey) || 0;

            tempCache.set(
              contractKey,
              prevContractValue + +record.pnl * +record.collateralPriceUsd,
            );

            if (!testContractIdsMap.get(record.contractId)) {
              tempCache.set(
                overallKey,
                prevOverallValue + +record.pnl * +record.collateralPriceUsd,
              );
            }
          }
        }

        const cachedKeys = Array.from(tempCache.keys());

        if (cachedKeys.length > 10_0000) {
          await this.storeCacheToPnlsnapshot(dateStr, tempCache);
          tempCache.clear();
        }

        currentCursorId = records[records.length - 1].id;
      }

      const cachedKeys = Array.from(tempCache.keys());

      if (cachedKeys.length > 0) {
        await this.storeCacheToPnlsnapshot(dateStr, tempCache);
        tempCache.clear();
      }

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsService>dynamicSnapshotBuild: ${dateStr}`,
        details: `finished`,
      });

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

      let cursorId: number | null = null;

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsService>buildSnapshots: ${dateStr} ${isForceBuild}`,
      });

      await this.prismaService.pnlSnapshot.deleteMany({ where: { dateStr } });

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>buildSnapshots`,
        details: 'deleted old pnl snapshot',
      });

      const testContractIdsMap = new Map<number, boolean>();

      const testContracts = await this.prismaService.contract.findMany({
        where: {
          isTestnet: true,
        },
      });

      testContracts.forEach((contract) =>
        testContractIdsMap.set(contract.id, true),
      );

      const tempCache = new Map<string, number>();

      const startedTime = Date.now();

      while (true) {
        const chunkTime = Date.now();

        this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsService>buildSnapshots`,
          details: `find many perp trading event logs ${cursorId}`,
        });

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
                { id: 'asc' },
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
                { id: 'asc' },
              ],
            });

        if (records.length === 0) {
          break;
        }

        for (const record of records) {
          for (const kind of availableKinds) {
            const contractKey = getKey(record.address, kind, record.contractId);
            const overallKey = getKey(record.address, kind, 0);

            const timestampGap = timestampGapByPnlSnapshotKind[kind];
            const prevContractValue = tempCache.get(contractKey) || 0;
            const prevOverallValue = tempCache.get(overallKey) || 0;

            if (upperBound.getTime() - timestampGap < record.date.getTime()) {
              tempCache.set(
                contractKey,
                prevContractValue + +record.pnl * +record.collateralPriceUsd,
              );

              if (!testContractIdsMap.get(record.contractId)) {
                tempCache.set(
                  overallKey,
                  prevOverallValue + +record.pnl * +record.collateralPriceUsd,
                );
              }
            }
          }
        }

        const storedKeys = Array.from(tempCache.keys());

        // we need to clean cache for prevent memory execeed.
        if (storedKeys.length > 10_0000) {
          await this.storeCacheToPnlsnapshot(dateStr, tempCache);
          tempCache.clear();
        }

        this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsService>buildSnapshots`,
          details: `chunk time ${Date.now() - chunkTime}ms`,
        });

        cursorId = records[records.length - 1].id;
      }

      const storedKeys = Array.from(tempCache.keys());

      if (storedKeys.length > 0) {
        await this.storeCacheToPnlsnapshot(dateStr, tempCache);
        tempCache.clear();
      }

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsService>buildSnapshots`,
        details: `total time ${Date.now() - startedTime}ms`,
      });

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

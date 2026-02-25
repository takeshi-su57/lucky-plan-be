import { Injectable } from '@nestjs/common';
import {
  PerpTradingEventLog,
  Platform,
  PnlSnapshotKind,
  PnlSnapshotV2,
} from 'generated/prisma/client';
import * as dayjs from 'dayjs';
import { LogsService } from 'src/global/logs.service';

import { SimpleLinearRegression } from 'ml-regression-simple-linear';
import { PrismaService } from 'src/global/prisma.service';
import { ServiceStatus } from 'src/types';
import { getReadableError, getStartOfDay } from 'src/utils';
import {
  PnlSnapshotV2DetailsConnection,
  PnlSnapshotV2DetailsEdge,
} from './entities/event-logs.entity';

function parseKey(key: string) {
  return JSON.parse(key) as {
    address: string;
    platform: Platform;
    kind: PnlSnapshotKind;
  };
}

function getKey(address: string, platform: Platform, kind: PnlSnapshotKind) {
  return JSON.stringify({
    address: address.toLowerCase(),
    platform,
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
  status: ServiceStatus;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly logger: LogsService,
  ) {
    this.status = ServiceStatus.READY;
  }

  async getPnlSnapshots(
    dateStr: string,
    platform: Platform,
    kind: PnlSnapshotKind,
    first: number,
    after: number | null,
    minSlope: number,
    minR2: number,
  ): Promise<PnlSnapshotV2DetailsConnection> {
    const testContracts = await this.prismaService.contract.findMany({
      where: {
        isTestnet: true,
      },
    });

    const testContractIds = testContracts.map((item) => item.id);

    const timestampGap =
      timestampGapByPnlSnapshotKind[
        kind as keyof typeof timestampGapByPnlSnapshotKind
      ];
    const startDate = new Date(
      getStartOfDay(new Date(dateStr)).getTime() - timestampGap,
    );
    const endDate = new Date(dateStr);

    const edges: PnlSnapshotV2DetailsEdge[] = [];
    let currentAfter = after;
    let hasNextPage = true;

    while (edges.length < first) {
      const lastPnlRecord = currentAfter
        ? await this.prismaService.pnlSnapshotV2.findFirst({
            where: { id: currentAfter },
          })
        : null;

      const currentCursor = lastPnlRecord
        ? {
            id: lastPnlRecord.id,
            accUSDPnl: lastPnlRecord.accUSDPnl,
          }
        : null;

      const pnlRecords: PnlSnapshotV2[] = currentCursor
        ? await this.prismaService.pnlSnapshotV2.findMany({
            take: first,
            where: {
              dateStr,
              kind,
              platform,
              accUSDPnl: {
                gt: 100,
              },
              OR: [
                {
                  accUSDPnl: {
                    lt: currentCursor.accUSDPnl,
                  },
                },
                {
                  accUSDPnl: currentCursor.accUSDPnl,
                  id: {
                    gt: currentCursor.id,
                  },
                },
              ],
            },
            orderBy: [
              {
                accUSDPnl: 'desc',
              },
              {
                id: 'asc',
              },
            ],
          })
        : await this.prismaService.pnlSnapshotV2.findMany({
            take: first,
            where: {
              dateStr,
              kind,
              platform,
              accUSDPnl: {
                not: 0,
              },
            },
            orderBy: [
              {
                accUSDPnl: 'desc',
              },
              {
                id: 'asc',
              },
            ],
          });

      if (pnlRecords.length === 0) {
        hasNextPage = false;
        break;
      }

      for (const pnlRecord of pnlRecords) {
        if (edges.length >= first) break;

        const historyRecords = (
          await this.prismaService.perpTradingEventLog.findMany({
            where: {
              address: pnlRecord.address.toLowerCase(),
              platform,
              date: {
                gt: startDate,
                lte: endDate,
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
        ).filter((item) => !testContractIds.includes(item.contractId));

        if (historyRecords.length < 2) continue;

        const xs: number[] = [];
        const pnlArrs: number[] = [];
        let pnlSum = 0;

        for (let i = 0; i < historyRecords.length; i++) {
          pnlSum += +historyRecords[i].usdPnl;
          pnlArrs.push(pnlSum);
          xs.push(i);
        }

        const regression = new SimpleLinearRegression(xs, pnlArrs);
        const score = regression.score(xs, pnlArrs);

        let r2 = score.r2;
        if (Number.isNaN(r2)) r2 = 1;
        if (r2 === Infinity) continue;

        if (regression.slope < minSlope || r2 < minR2) continue;

        edges.push({
          cursor: pnlRecord.id,
          node: {
            ...pnlRecord,
            perpTradingEventLogs: historyRecords.slice(
              Math.max(0, historyRecords.length - 2500),
              historyRecords.length,
            ),
          },
        });
      }

      currentAfter = pnlRecords[pnlRecords.length - 1].id;

      if (pnlRecords.length < first) {
        hasNextPage = false;
        break;
      }
    }

    return {
      edges,
      pageInfo: {
        hasNextPage,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
    };
  }

  async removeNegativePnlSnapshot(platform: Platform, dateStr: string) {
    const { count } = await this.prismaService.pnlSnapshotV2.deleteMany({
      where: {
        accUSDPnl: { lte: 0 },
        platform,
        dateStr,
      },
    });

    this.logger.log({
      severity: 'Info',
      summary: 'PnlSnapshotsV2Service>removeNegativePnlSnapshot',
      details: `removeNegativePnlSnapshot ${dateStr}: ${count}`,
    });
  }

  async dynamicSnapshotBuild(platform: Platform, dateStr: string) {
    this.status = ServiceStatus.PROCESS;

    const lastDayStr = dayjs(dateStr).subtract(1, 'day').format('YYYY-MM-DD');

    await this.logger.nativeLog({
      severity: 'Debug',
      summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr} lastDayStr: ${lastDayStr}`,
    });

    try {
      const isInitialized = await this.isPnlSnapshotInitialized(
        platform,
        lastDayStr,
      );

      if (!isInitialized?.isInit) {
        throw new Error('Pnl snapshot is not initialized');
      }

      const lowerBound = dayjs(dateStr).startOf('day').toDate().getTime();
      const upperBound = dayjs(dateStr).endOf('day').toDate().getTime();

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr} lowerBound: ${lowerBound} upperBound: ${upperBound} gap: ${upperBound - lowerBound}`,
      });

      await this.prismaService.pnlSnapshotV2.deleteMany({
        where: {
          platform,
          dateStr,
        },
      });

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
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

      const testContractIds = testContracts.map((contract) => contract.id);

      let pnlSnapshotCursorId: number | null = null;

      const cloneTime = Date.now();

      // clone last day's pnl snapshot for dynamic snapshot build
      while (true) {
        const records: PnlSnapshotV2[] = pnlSnapshotCursorId
          ? await this.prismaService.pnlSnapshotV2.findMany({
              skip: 1,
              take: BATCH_SIZE,
              cursor: {
                id: pnlSnapshotCursorId,
              },
              where: {
                dateStr: lastDayStr,
                platform,
              },
              orderBy: [{ id: 'asc' }],
            })
          : await this.prismaService.pnlSnapshotV2.findMany({
              take: BATCH_SIZE,
              where: {
                dateStr: lastDayStr,
                platform,
              },
              orderBy: [{ id: 'asc' }],
            });

        if (records.length === 0) {
          break;
        }

        const upsertInputs = records.map((record) => {
          return {
            address: record.address,
            platform: record.platform,
            kind: record.kind,
            accUSDPnl: record.accUSDPnl,
            dateStr,
          };
        });

        await this.prismaService.pnlSnapshotV2.createMany({
          data: upsertInputs,
        });

        pnlSnapshotCursorId = records[records.length - 1].id;
      }

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
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
          await this.logger.nativeLog({
            severity: 'Debug',
            summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
            details: `substract pnl by outdated pnl snapshot ${cursorId}`,
          });

          const records: PerpTradingEventLog[] = (
            cursorId
              ? await this.prismaService.perpTradingEventLog.findMany({
                  skip: 1,
                  take: BATCH_SIZE,
                  cursor: {
                    id: cursorId,
                  },
                  where: {
                    platform,
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
                    {
                      id: 'asc',
                    },
                  ],
                })
              : await this.prismaService.perpTradingEventLog.findMany({
                  take: BATCH_SIZE,
                  where: {
                    date: {
                      gte: new Date(pastLowerBound),
                      lte: new Date(pastUpperBound),
                    },
                    platform,
                  },
                  orderBy: [
                    {
                      date: 'asc',
                    },
                    {
                      block: 'asc',
                    },
                    {
                      id: 'asc',
                    },
                  ],
                })
          ).filter((item) => !testContractIds.includes(item.contractId));

          if (records.length === 0) {
            break;
          }

          for (const record of records) {
            const overallKey = getKey(record.address, record.platform, kind);

            const prevOverallValue = tempCache.get(overallKey) || 0;

            tempCache.set(overallKey, prevOverallValue - +record.usdPnl);
          }

          const historiesPnlMapKeys = Array.from(tempCache.keys());

          if (historiesPnlMapKeys.length > 10_0000) {
            await this.storeCacheToPnlsnapshotV2(dateStr, tempCache);
            tempCache.clear();
          }

          cursorId = records[records.length - 1].id;
        }

        const cachedKeys = Array.from(tempCache.keys());

        if (cachedKeys.length > 0) {
          await this.storeCacheToPnlsnapshotV2(dateStr, tempCache);
          tempCache.clear();
        }
      }

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
        details: `substract pnl by outdated pnl snapshot ${substractTime - Date.now()}ms`,
      });

      let currentCursorId: number | null = null;

      const tempCache = new Map<string, number>();

      // add pnl by perp trading event logs
      while (true) {
        this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
          details: `add pnl by perp trading event logs ${currentCursorId}`,
        });

        const records: PerpTradingEventLog[] = (
          currentCursorId
            ? await this.prismaService.perpTradingEventLog.findMany({
                skip: 1,
                take: BATCH_SIZE,
                cursor: {
                  id: currentCursorId,
                },
                where: {
                  platform,
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
                  {
                    id: 'asc',
                  },
                ],
              })
            : await this.prismaService.perpTradingEventLog.findMany({
                take: BATCH_SIZE,
                where: {
                  platform,
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
                  {
                    id: 'asc',
                  },
                ],
              })
        ).filter((item) => !testContractIds.includes(item.contractId));

        if (records.length === 0) {
          break;
        }

        for (const record of records) {
          for (const kind of availableKinds) {
            const overallKey = getKey(record.address, record.platform, kind);

            const prevOverallValue = tempCache.get(overallKey) || 0;

            tempCache.set(overallKey, prevOverallValue + +record.usdPnl);
          }
        }

        const cachedKeys = Array.from(tempCache.keys());

        if (cachedKeys.length > 10_0000) {
          await this.storeCacheToPnlsnapshotV2(dateStr, tempCache);
          tempCache.clear();
        }

        currentCursorId = records[records.length - 1].id;
      }

      const cachedKeys = Array.from(tempCache.keys());

      if (cachedKeys.length > 0) {
        await this.storeCacheToPnlsnapshotV2(dateStr, tempCache);
        tempCache.clear();
      }

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
        details: `finished`,
      });

      const pnlSnapshotInitializedFlag =
        await this.prismaService.pnlSnapshotV2InitializedFlag.upsert({
          where: {
            platform_dateStr: {
              platform,
              dateStr,
            },
          },
          update: {
            isInit: true,
          },
          create: {
            platform,
            dateStr,
            isInit: true,
          },
        });

      this.status = ServiceStatus.READY;

      return pnlSnapshotInitializedFlag;
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: LastDay: ${lastDayStr} CurrentDay: ${dateStr}`,
        details: getReadableError(err),
      });

      this.status = ServiceStatus.READY;
      return null;
    }
  }

  private async storeCacheToPnlsnapshotV2(
    dateStr: string,
    tempCache: Map<string, number>,
  ) {
    const storedKeys = Array.from(tempCache.keys());

    const startedTime = Date.now();

    for (let i = 0; i < storedKeys.length; i += BATCH_SIZE / 10) {
      const chunkTime = Date.now();

      const chunk = storedKeys.slice(i, i + BATCH_SIZE / 10);

      const pnlRecords = await this.prismaService.pnlSnapshotV2.findMany({
        where: {
          OR: [
            ...chunk.map((key) => {
              const { address, platform, kind } = parseKey(key);

              return {
                dateStr,
                address: address.toLowerCase(),
                platform,
                kind,
              };
            }),
          ],
        },
      });

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>buildSnapshots`,
        details: `pnlRecords chunk ${i} ~ ${i + chunk.length} ${pnlRecords.length}`,
      });

      const pnlRecordsMap = new Map<string, number>();

      pnlRecords.forEach((record) => {
        const key = getKey(record.address, record.platform, record.kind);

        pnlRecordsMap.set(key, record.accUSDPnl);
      });

      const upsertInputs = chunk.map((key) => {
        const { address, platform, kind } = parseKey(key);

        const accValue = tempCache.get(key) || 0;
        const prevValue = pnlRecordsMap.get(key) || 0;

        return {
          address: address.toLowerCase(),
          platform,
          kind,
          accUSDPnl: prevValue + accValue,
          dateStr,
        };
      });

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>buildSnapshots`,
        details: `upsertInputs chunk ${i} ~ ${i + chunk.length} ${upsertInputs.length}`,
      });

      await this.prismaService.$transaction(
        upsertInputs.map((input) => {
          return this.prismaService.pnlSnapshotV2.upsert({
            where: {
              address_platform_dateStr_kind: {
                address: input.address.toLowerCase(),
                dateStr: input.dateStr,
                platform: input.platform,
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

  async buildSnapshots(
    platform: Platform,
    dateStr: string,
    isForceBuild: boolean,
  ) {
    this.status = ServiceStatus.PROCESS;

    try {
      if (!isForceBuild) {
        const isInitialized = await this.isPnlSnapshotInitialized(
          platform,
          dateStr,
        );

        if (isInitialized?.isInit) {
          this.status = ServiceStatus.READY;

          return isInitialized;
        }
      }

      const upperBound = dayjs(dateStr).endOf('day').toDate();

      let cursorId: number | null = null;

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>buildSnapshots: ${platform} ${dateStr} ${isForceBuild}`,
      });

      await this.prismaService.pnlSnapshotV2.deleteMany({ where: { dateStr } });

      await this.logger.nativeLog({
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

      const testContractIds = testContracts.map((contract) => contract.id);

      testContracts.forEach((contract) =>
        testContractIdsMap.set(contract.id, true),
      );

      const tempCache = new Map<string, number>();

      const startedTime = Date.now();

      while (true) {
        const chunkTime = Date.now();
        await this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsV2Service>buildSnapshots`,
          details: `find many perp trading event logs ${cursorId}`,
        });

        const records: PerpTradingEventLog[] = (
          cursorId
            ? await this.prismaService.perpTradingEventLog.findMany({
                skip: 1,
                take: BATCH_SIZE,
                cursor: {
                  id: cursorId,
                },
                where: {
                  platform,
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
                  {
                    id: 'asc',
                  },
                ],
              })
            : await this.prismaService.perpTradingEventLog.findMany({
                take: BATCH_SIZE,
                where: {
                  platform,
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
                  {
                    id: 'asc',
                  },
                ],
              })
        ).filter((item) => !testContractIds.includes(item.contractId));

        if (records.length === 0) {
          break;
        }

        for (const record of records) {
          for (const kind of availableKinds) {
            const overallKey = getKey(record.address, record.platform, kind);

            const timestampGap = timestampGapByPnlSnapshotKind[kind];
            const prevOverallValue = tempCache.get(overallKey) || 0;

            if (upperBound.getTime() - timestampGap < record.date.getTime()) {
              tempCache.set(overallKey, prevOverallValue + +record.usdPnl);
            }
          }
        }

        const storedKeys = Array.from(tempCache.keys());

        // we need to clean cache for prevent memory execeed.
        if (storedKeys.length > 10_0000) {
          await this.storeCacheToPnlsnapshotV2(dateStr, tempCache);
          tempCache.clear();
        }

        this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsV2Service>buildSnapshots`,
          details: `chunk time ${Date.now() - chunkTime}ms`,
        });

        cursorId = records[records.length - 1].id;
      }

      const storedKeys = Array.from(tempCache.keys());

      if (storedKeys.length > 0) {
        await this.storeCacheToPnlsnapshotV2(dateStr, tempCache);
        tempCache.clear();
      }

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>buildSnapshots`,
        details: `total time ${Date.now() - startedTime}ms`,
      });

      const pnlSnapshotInitializedFlag =
        await this.prismaService.pnlSnapshotV2InitializedFlag.upsert({
          where: {
            platform_dateStr: {
              platform,
              dateStr,
            },
          },
          update: {
            isInit: true,
          },
          create: {
            platform,
            dateStr,
            isInit: true,
          },
        });

      this.status = ServiceStatus.READY;

      return pnlSnapshotInitializedFlag;
    } catch (err) {
      await this.logger.log({
        severity: 'Error',
        summary: `PnlSnapshotsV2Service>intialBuild`,
        details: getReadableError(err),
      });

      this.status = ServiceStatus.READY;
      return null;
    }
  }

  async initializePnlSnapshot(
    platform: Platform,
    beginingDate: Date,
    isForceBuild: boolean,
  ) {
    if (isForceBuild) {
      await this.buildSnapshots(
        platform,
        dayjs(beginingDate).format('YYYY-MM-DD'),
        true,
      );
    }

    let startDate = dayjs(beginingDate).add(1, 'day').toDate();

    while (startDate.getTime() < dayjs().endOf('day').toDate().getTime()) {
      this.logger.nativeLog({
        severity: 'Info',
        summary: `Completed: ${dayjs(startDate).format('YYYY-MM-DD')}`,
      });

      const result = await this.dynamicSnapshotBuild(
        platform,
        dayjs(startDate).format('YYYY-MM-DD'),
      );

      await this.removeNegativePnlSnapshot(
        platform,
        dayjs(startDate).subtract(3, 'day').format('YYYY-MM-DD'),
      );

      startDate = dayjs(startDate).add(1, 'day').toDate();

      if (!result) {
        break;
      }
    }

    return true;
  }

  async isPnlSnapshotInitialized(platform: Platform, dateStr: string) {
    return await this.prismaService.pnlSnapshotV2InitializedFlag.findUnique({
      where: {
        platform_dateStr: {
          platform,
          dateStr,
        },
      },
    });
  }

  async getAllPnlSnapshotInitializedFlag(platform: Platform) {
    return await this.prismaService.pnlSnapshotV2InitializedFlag.findMany({
      where: {
        platform,
      },
      orderBy: {
        dateStr: 'desc',
      },
    });
  }

  async getPnlSnapshotsByAddress(
    platform: Platform,
    dateStr: string,
    address: string,
  ): Promise<PnlSnapshotV2[]> {
    return await this.prismaService.pnlSnapshotV2.findMany({
      where: {
        dateStr,
        address,
        platform,
      },
    });
  }
}

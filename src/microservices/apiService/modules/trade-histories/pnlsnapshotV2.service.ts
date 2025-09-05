import { Injectable } from '@nestjs/common';
import {
  PerpTradingEventLog,
  Platform,
  PnlSnapshotKind,
  PnlSnapshotV2,
} from '@prisma/client';
import * as dayjs from 'dayjs';
import { LogsService } from 'src/global/logs.service';

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

@Injectable()
export class PnlSnapshotsV2Service {
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
  ): Promise<PnlSnapshotV2DetailsConnection> {
    const pnlRecords: PnlSnapshotV2[] = after
      ? await this.prismaService.pnlSnapshotV2.findMany({
          skip: after ? 1 : undefined,
          take: first,
          cursor: {
            id: after,
          },
          where: {
            dateStr,
            kind,
            platform,
            accUSDPnl: {
              not: 0,
            },
          },
          orderBy: {
            accUSDPnl: 'desc',
          },
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
          orderBy: {
            accUSDPnl: 'desc',
          },
        });

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

    const historyRecords =
      await this.prismaService.perpTradingEventLog.findMany({
        where: {
          OR: [
            ...pnlRecords.map((item) => ({
              address: item.address,
              platform,
              contractId: {
                notIn: testContractIds,
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

    const historyRecordsMap = new Map<string, PerpTradingEventLog[]>();

    historyRecords.forEach((record) => {
      const arr = historyRecordsMap.get(record.address);

      if (arr) {
        arr.push(record);
      } else {
        historyRecordsMap.set(record.address, [record]);
      }
    });

    const edges: PnlSnapshotV2DetailsEdge[] = pnlRecords.map((record) => ({
      cursor: record.id,
      node: {
        ...record,
        perpTradingEventLogs: historyRecordsMap.get(record.address) || [],
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

  private async removeNegativePnlSnapshot(platform: Platform, dateStr: string) {
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

    const BATCH_SIZE = 1000;
    const lastDayStr = dayjs(dateStr).subtract(1, 'day').format('YYYY-MM-DD');

    this.logger.nativeLog({
      severity: 'Debug',
      summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
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

      await this.prismaService.pnlSnapshotV2.deleteMany({
        where: {
          platform,
          dateStr,
        },
      });

      this.logger.nativeLog({
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
            })
          : await this.prismaService.pnlSnapshotV2.findMany({
              take: BATCH_SIZE,
              where: {
                dateStr: lastDayStr,
                platform,
              },
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

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
        details: `clone last days pnl snapshot`,
      });

      for (const kind of availableKinds) {
        let cursorId: number | null = null;

        const pastLowerBound = lowerBound - timestampGapByPnlSnapshotKind[kind];
        const pastUpperBound = upperBound - timestampGapByPnlSnapshotKind[kind];

        while (true) {
          this.logger.nativeLog({
            severity: 'Debug',
            summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
            details: `substract pnl by outdated pnl snapshot ${cursorId}`,
          });

          const records: PerpTradingEventLog[] = cursorId
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
                  contractId: {
                    notIn: testContractIds,
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
            : await this.prismaService.perpTradingEventLog.findMany({
                take: BATCH_SIZE,
                where: {
                  date: {
                    gte: new Date(pastLowerBound),
                    lte: new Date(pastUpperBound),
                  },
                  platform,
                  contractId: {
                    notIn: testContractIds,
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

          const historiesPnlMap = new Map<string, number>();

          for (const record of records) {
            const overallKey = getKey(record.address, record.platform, kind);

            const prevOverallValue = historiesPnlMap.get(overallKey) || 0;

            historiesPnlMap.set(overallKey, prevOverallValue + +record.usdPnl);
          }

          const historiesPnlMapKeys = Array.from(historiesPnlMap.keys());

          const pnlRecords = await this.prismaService.pnlSnapshotV2.findMany({
            where: {
              OR: [
                ...historiesPnlMapKeys.map((key) => {
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

          const pnlRecordsMap = new Map<string, number>();

          pnlRecords.forEach((record) => {
            const key = getKey(record.address, record.platform, record.kind);

            pnlRecordsMap.set(key, record.accUSDPnl);
          });

          const upsertInputs = historiesPnlMapKeys.map((key) => {
            const { address, platform, kind } = parseKey(key);

            const accValue = historiesPnlMap.get(key) || 0;
            const prevValue = pnlRecordsMap.get(key) || 0;

            return {
              address: address.toLowerCase(),
              platform,
              kind,
              accUSDPnl: prevValue - accValue,
              dateStr,
            };
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

          cursorId = records[records.length - 1].id;
        }
      }

      let currentCursorId: number | null = null;

      while (true) {
        this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
          details: `add pnl by perp trading event logs ${currentCursorId}`,
        });

        const records: PerpTradingEventLog[] = currentCursorId
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
                contractId: {
                  notIn: testContractIds,
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
          : await this.prismaService.perpTradingEventLog.findMany({
              take: BATCH_SIZE,
              where: {
                platform,
                date: {
                  gte: new Date(lowerBound),
                  lte: new Date(upperBound),
                },
                contractId: {
                  notIn: testContractIds,
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

        const historiesPnlMap = new Map<string, number>();

        for (const record of records) {
          for (const kind of availableKinds) {
            const overallKey = getKey(record.address, record.platform, kind);

            const prevOverallValue = historiesPnlMap.get(overallKey) || 0;

            historiesPnlMap.set(overallKey, prevOverallValue + +record.usdPnl);
          }
        }

        const historiesPnlMapKeys = Array.from(historiesPnlMap.keys());

        const pnlRecords: PnlSnapshotV2[] = [];

        for (let i = 0; i < historiesPnlMapKeys.length; i += BATCH_SIZE) {
          const chunk = historiesPnlMapKeys.slice(i, BATCH_SIZE);

          const pnlChunk = await this.prismaService.pnlSnapshotV2.findMany({
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

          pnlRecords.push(...pnlChunk);
        }

        const pnlRecordsMap = new Map<string, number>();

        pnlRecords.forEach((record) => {
          const key = getKey(record.address, record.platform, record.kind);

          pnlRecordsMap.set(key, record.accUSDPnl);
        });

        const upsertInputs = historiesPnlMapKeys.map((key) => {
          const { address, platform, kind } = parseKey(key);

          const accValue = historiesPnlMap.get(key) || 0;
          const prevValue = pnlRecordsMap.get(key) || 0;

          return {
            address: address.toLowerCase(),
            platform,
            kind,
            accUSDPnl: prevValue + accValue,
            dateStr,
          };
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

        currentCursorId = records[records.length - 1].id;
      }

      this.logger.nativeLog({
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

      const BATCH_SIZE = 1000;
      let cursorId: number | null = null;

      this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>buildSnapshots: ${platform} ${dateStr} ${isForceBuild}`,
      });

      await this.prismaService.pnlSnapshotV2.deleteMany({ where: { dateStr } });

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

      const testContractIds = testContracts.map((contract) => contract.id);

      testContracts.forEach((contract) =>
        testContractIdsMap.set(contract.id, true),
      );

      while (true) {
        this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsV2Service>buildSnapshots`,
          details: `find many perp trading event logs ${cursorId}`,
        });

        const records: PerpTradingEventLog[] = cursorId
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
                contractId: {
                  notIn: testContractIds,
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
          : await this.prismaService.perpTradingEventLog.findMany({
              take: BATCH_SIZE,
              where: {
                platform,
                date: {
                  lte: upperBound,
                },
                contractId: {
                  notIn: testContractIds,
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

        const historiesPnlMap = new Map<string, number>();

        for (const record of records) {
          for (const kind of availableKinds) {
            const overallKey = getKey(record.address, record.platform, kind);

            const timestampGap = timestampGapByPnlSnapshotKind[kind];
            const prevOverallValue = historiesPnlMap.get(overallKey) || 0;

            if (upperBound.getTime() - timestampGap < record.date.getTime()) {
              historiesPnlMap.set(
                overallKey,
                prevOverallValue + +record.usdPnl,
              );
            }
          }
        }

        const historiesPnlMapKeys = Array.from(historiesPnlMap.keys());

        const pnlRecords = await this.prismaService.pnlSnapshotV2.findMany({
          where: {
            OR: [
              ...historiesPnlMapKeys.map((key) => {
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

        this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsV2Service>buildSnapshots`,
          details: `pnlRecords ${pnlRecords.length}`,
        });

        const pnlRecordsMap = new Map<string, number>();

        pnlRecords.forEach((record) => {
          const key = getKey(record.address, record.platform, record.kind);

          pnlRecordsMap.set(key, record.accUSDPnl);
        });

        const upsertInputs = historiesPnlMapKeys.map((key) => {
          const { address, platform, kind } = parseKey(key);

          const accValue = historiesPnlMap.get(key) || 0;
          const prevValue = pnlRecordsMap.get(key) || 0;

          return {
            address: address.toLowerCase(),
            platform,
            kind,
            accUSDPnl: prevValue + accValue,
            dateStr,
          };
        });

        this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsV2Service>buildSnapshots`,
          details: `upsertInputs ${upsertInputs.length}`,
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

        cursorId = records[records.length - 1].id;
      }

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
}

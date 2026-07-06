import { Injectable } from '@nestjs/common';
import {
  PerpTradingEventLog,
  Platform,
  PnlSnapshotV2,
} from 'generated/prisma/client';
import dayjs from 'dayjs';
import { LogsService } from 'src/global/logs.service';

import { PrismaService } from 'src/global/prisma.service';
import { ServiceStatus } from 'src/types';
import { getReadableError, getStartOfDay } from 'src/utils';
import { PnlSnapshotV2DetailsPaginatedResponse } from './entities/event-logs.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { getWeb3Info } from 'src/web3/utils';
import { EventLogsService } from './event-logs.service';

function parseKey(key: string) {
  return JSON.parse(key) as {
    address: string;
    platform: Platform;
  };
}

function getKey(address: string, platform: Platform) {
  return JSON.stringify({
    address: address.toLowerCase(),
    platform,
  });
}

const timestampGapByThreeMonthPnlSnapshot = 3 * 30 * 24 * 60 * 60 * 1000;

const BATCH_SIZE = 5000;
@Injectable()
export class PnlSnapshotsService {
  status: ServiceStatus;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly eventLogService: EventLogsService,
    private readonly logger: LogsService,
  ) {
    this.status = ServiceStatus.READY;
  }

  async getPnlSnapshots(
    dateStr: string,
    platform: Platform,
    isDesc: boolean,
    maxLeverage: number | null,
    page: number,
    pageSize: number,
  ): Promise<PnlSnapshotV2DetailsPaginatedResponse> {
    const safePage = Math.max(page, 0);
    const safePageSize = Math.max(pageSize, 1);

    const allContractsMap: Record<string, Contract> = {};

    const allContracts = await this.prismaService.contract.findMany();

    allContracts.forEach((contract) => {
      allContractsMap[contract.id] = contract;
    });

    const timestampGap = timestampGapByThreeMonthPnlSnapshot;
    const startDate = new Date(
      getStartOfDay(new Date(dateStr)).getTime() - timestampGap,
    );
    const endDate = new Date(dateStr);

    const total = await this.prismaService.pnlSnapshotV2.count({
      where: { dateStr, platform },
    });

    const pnlRecords: PnlSnapshotV2[] =
      await this.prismaService.pnlSnapshotV2.findMany({
        take: safePageSize,
        skip: safePage * safePageSize,
        where: {
          dateStr,
          platform,
        },
        orderBy: [
          {
            accUSDPnl: isDesc ? 'desc' : 'asc',
          },
          {
            address: 'asc',
          },
        ],
      });

    const pnlRecordAddresses = pnlRecords.map((record) =>
      record.address.toLowerCase(),
    );
    const rawHistoryRecords =
      pnlRecordAddresses.length === 0
        ? []
        : await this.prismaService.perpTradingEventLog.findMany({
            where: {
              address: {
                in: pnlRecordAddresses,
              },
              platform,
              date: {
                gt: startDate,
                lte: endDate,
              },
            },
            orderBy: [
              {
                address: 'asc',
              },
              {
                date: 'asc',
              },
              {
                block: 'asc',
              },
            ],
            select: {
              id: true,
              address: true,
              contractId: true,
              jsonLog: true,
              date: true,
            },
          });

    const historyRecordsByAddress = new Map<string, typeof rawHistoryRecords>();

    rawHistoryRecords.forEach((record) => {
      const recordAddress = record.address.toLowerCase();
      const records = historyRecordsByAddress.get(recordAddress);

      if (records) {
        records.push(record);
        return;
      }

      historyRecordsByAddress.set(recordAddress, [record]);
    });

    const records = pnlRecords
      .map((pnlRecord) => {
        const historyRecords =
          historyRecordsByAddress.get(pnlRecord.address.toLowerCase()) ?? [];

        if (historyRecords.length < 2) {
          return null;
        }

        const perpTradeHistories = historyRecords
          .map((record) => {
            const contract = allContractsMap[record.contractId];

            if (!contract) {
              return null;
            }

            const history = getWeb3Info(
              contract.platform,
              contract.version,
            ).eventToPerpTradeHistory(
              contract.chainId,
              JSON.parse(record.jsonLog) as any,
            );

            if (!history) {
              return null;
            }

            return {
              ...history,
              id: record.id,
              date: record.date,
              chainId: contract.chainId,
              contractId: record.contractId,
              platform: contract.platform,
            };
          })
          .filter((item) => !!item);

        return {
          ...pnlRecord,
          positionsWithSummary:
            this.eventLogService.convertToPerpTradePositionsWithSummary(
              platform,
              perpTradeHistories,
              { maxLeverage: maxLeverage ?? undefined },
            ),
        };
      })
      .filter((item) => !!item);

    return {
      items: records,
      total,
      currentPage: safePage,
      totalPages: Math.ceil(total / safePageSize),
    };
  }

  async removePnlSnapshot(platform: Platform, dateStr: string) {
    await this.prismaService.pnlSnapshotV2.deleteMany({
      where: {
        platform,
        dateStr,
      },
    });

    await this.prismaService.pnlSnapshotV2InitializedFlag.upsert({
      where: {
        platform_dateStr: {
          platform,
          dateStr,
        },
      },
      update: {
        isInit: false,
      },
      create: {
        platform,
        dateStr,
        isInit: false,
      },
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

      await this.removePnlSnapshot(platform, dateStr);

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
        details: 'deleted many',
      });

      let pnlSnapshotCursorId: string | null = null;

      const cloneTime = Date.now();

      // clone last day's pnl snapshot for dynamic snapshot build
      while (true) {
        const records: PnlSnapshotV2[] =
          await this.prismaService.pnlSnapshotV2.findMany({
            take: BATCH_SIZE,
            where: {
              dateStr: lastDayStr,
              platform,
              address: pnlSnapshotCursorId
                ? {
                    gt: pnlSnapshotCursorId,
                  }
                : undefined,
            },
            orderBy: [{ address: 'asc' }],
          });

        if (records.length === 0) {
          break;
        }

        const upsertInputs = records.map((record) => {
          return {
            address: record.address,
            platform: record.platform,
            accUSDPnl: record.accUSDPnl,
            dateStr,
          };
        });

        await this.prismaService.pnlSnapshotV2.createMany({
          data: upsertInputs,
        });

        pnlSnapshotCursorId = records[records.length - 1].address;
      }

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>dynamicSnapshotBuild: ${platform} ${dateStr}`,
        details: `clone last days pnl snapshot ${cloneTime - Date.now()}ms`,
      });

      const substractTime = Date.now();

      // substract pnl by outdated pnl snapshot
      let cursorId: number | null = null;

      const pastLowerBound = lowerBound - timestampGapByThreeMonthPnlSnapshot;
      const pastUpperBound = upperBound - timestampGapByThreeMonthPnlSnapshot;

      const tempCache1 = new Map<string, number>();

      while (true) {
        await this.logger.nativeLog({
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
            });

        if (records.length === 0) {
          break;
        }

        for (const record of records) {
          const overallKey = getKey(record.address, record.platform);

          const prevOverallValue = tempCache1.get(overallKey) || 0;

          tempCache1.set(overallKey, prevOverallValue - +record.usdPnl);
        }

        const historiesPnlMapKeys = Array.from(tempCache1.keys());

        if (historiesPnlMapKeys.length > 10_0000) {
          await this.storeCacheToPnlsnapshotV2(dateStr, tempCache1);
          tempCache1.clear();
        }

        cursorId = records[records.length - 1].id;
      }

      const cachedKeys1 = Array.from(tempCache1.keys());

      if (cachedKeys1.length > 0) {
        await this.storeCacheToPnlsnapshotV2(dateStr, tempCache1);
        tempCache1.clear();
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
            });

        if (records.length === 0) {
          break;
        }

        for (const record of records) {
          const overallKey = getKey(record.address, record.platform);

          const prevOverallValue = tempCache.get(overallKey) || 0;

          tempCache.set(overallKey, prevOverallValue + +record.usdPnl);
        }

        const cachedKeys = Array.from(tempCache.keys());

        if (cachedKeys.length > 5_0000) {
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
              const { address, platform } = parseKey(key);

              return {
                dateStr,
                address: address.toLowerCase(),
                platform,
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
        const key = getKey(record.address, record.platform);

        pnlRecordsMap.set(key, record.accUSDPnl);
      });

      const upsertInputs = chunk.map((key) => {
        const { address, platform } = parseKey(key);

        const accValue = tempCache.get(key) || 0;
        const prevValue = pnlRecordsMap.get(key) || 0;

        return {
          address: address.toLowerCase(),
          platform,
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
              address_platform_dateStr: {
                address: input.address.toLowerCase(),
                dateStr: input.dateStr,
                platform: input.platform,
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

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>buildSnapshots: ${platform} ${dateStr} ${isForceBuild}`,
      });

      await this.prismaService.pnlSnapshotV2.deleteMany({
        where: { dateStr, platform },
      });

      await this.logger.nativeLog({
        severity: 'Debug',
        summary: `PnlSnapshotsV2Service>buildSnapshots`,
        details: 'deleted old pnl snapshot',
      });

      const tempCache = new Map<string, number>();
      let lastDate: Date | null = null;
      let lastBlock: number | null = null;
      let lastId: number | null = null;

      const startedTime = Date.now();

      while (true) {
        const chunkTime = Date.now();
        await this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsV2Service>buildSnapshots`,
          details: `find many perp trading event logs lastId=${lastId}`,
        });

        const chunkRecords: Omit<PerpTradingEventLog, 'jsonLog'>[] =
          await this.prismaService.perpTradingEventLog.findMany({
            take: BATCH_SIZE,
            select: {
              id: true,
              contractId: true,
              usdPnl: true,
              block: true,
              logIndex: true,
              date: true,
              address: true,
              platform: true,
            },
            where: {
              platform,
              date: {
                lte: upperBound,
              },
              ...(lastDate != null
                ? {
                    OR: [
                      { date: { gt: lastDate } },
                      {
                        date: lastDate,
                        block: { gt: lastBlock! },
                      },
                      {
                        date: lastDate,
                        block: lastBlock!,
                        id: { gt: lastId! },
                      },
                    ],
                  }
                : {}),
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
          });

        if (chunkRecords.length === 0) {
          break;
        }

        const lastRecord = chunkRecords[chunkRecords.length - 1];
        lastDate = lastRecord.date;
        lastBlock = lastRecord.block;
        lastId = lastRecord.id;

        for (const record of chunkRecords) {
          const overallKey = getKey(record.address, record.platform);

          const timestampGap = timestampGapByThreeMonthPnlSnapshot;
          const prevOverallValue = tempCache.get(overallKey) || 0;

          if (upperBound.getTime() - timestampGap < record.date.getTime()) {
            tempCache.set(overallKey, prevOverallValue + +record.usdPnl);
          }
        }

        const storedKeys = Array.from(tempCache.keys());

        // we need to clean cache for prevent memory execeed.
        if (storedKeys.length > 100_000) {
          await this.storeCacheToPnlsnapshotV2(dateStr, tempCache);
          tempCache.clear();
        }

        await this.logger.nativeLog({
          severity: 'Debug',
          summary: `PnlSnapshotsV2Service>buildSnapshots`,
          details: `chunk time ${Date.now() - chunkTime}ms`,
        });
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

      await this.removePnlSnapshot(
        platform,
        dayjs(startDate)
          .subtract(360 * 2, 'days')
          .format('YYYY-MM-DD'),
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

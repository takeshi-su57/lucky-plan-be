import { Injectable } from '@nestjs/common';
import {
  PnlSnapshotKind,
  Platform,
  Contract,
  User,
  UserPermission,
  ContractStatus,
} from 'generated/prisma/client';
import { isAddress } from 'viem';
import * as dayjs from 'dayjs';
import { SimpleLinearRegression } from 'ml-regression-simple-linear';

import { PerpTradeHistory } from '../trade-histories/entities/event-logs.entity';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { PlansService } from './plans.service';
import { BotsService } from 'src/microservices/apiService/modules/bots/bots.service';

import { PnlSnapshotV2 } from '../trade-histories/entities/event-logs.entity';

import { ExpertFilterParams } from './expert-filters/v2.2';

import {
  ExpertPnlSnapshotV2,
  ExpertPnlSnapshotV2Connection,
} from './entities/plan.entity';
import { PerpTradingEventLog } from '../trade-histories/entities/event-logs.entity';
import { ServiceStatus } from 'src/types';
import { getWeb3Info } from 'src/web3/utils';
import { getReadableError } from 'src/utils';
import { CreatePlanInput } from './dto/plan.input';
import { CreateBotAndStrategyInput } from 'src/microservices/apiService/modules/bots/dto/bot.input';

const BLACKLIST_KEY = 'autoplans_v2_blacklist';
const WHITELIST_KEY = 'autoplans_v2_whitelist';

const DEGEN_PAIRS = [
  'BTCDEGEN/USD',
  'ETHDEGEN/USD',
  'SOLDEGEN/USD',
  'XRPDEGEN/USD',
  'BNBDEGEN/USD',
];

export type WhitelistedTrader = {
  minR2: number;
  ratio: number;
  maxSize: number;
  address: string;
  lastCount?: number;
  ignoreMinPnlLimit?: boolean;
  ignoreMinDurationLimit?: boolean;
};

function getMinR2OfSize(avgSize: number) {
  const scales = [0, 300, 2000, 5000, 10000, 30000, 100000, 1000000000];
  const r2s = [0.9, 0.93, 0.95, 0.93, 0.9, 0.85, 0.85, 0.85];
  const index = scales.findIndex((scale) => avgSize < scale);

  return (
    r2s[index - 1] +
    ((r2s[index] - r2s[index - 1]) * (avgSize - scales[index - 1])) /
      (scales[index] - scales[index - 1])
  );
}

function getMinR2OfCount(avgCount: number) {
  const scales = [0, 16, 32, 64, 128, 256, 512, 1000_000_000];
  const r2s = [0.93, 0.93, 0.915, 0.9, 0.8, 0.9, 0.95, 0.95];
  const index = scales.findIndex((scale) => avgCount < scale);

  return (
    r2s[index - 1] +
    ((r2s[index] - r2s[index - 1]) * (avgCount - scales[index - 1])) /
      (scales[index] - scales[index - 1])
  );
}

function getMinR2(avgSize: number, avgCount: number) {
  return (getMinR2OfSize(avgSize) + getMinR2OfCount(avgCount)) / 2;
}

@Injectable()
export class AutoPlansService {
  status: ServiceStatus = ServiceStatus.READY;
  allContracts: Record<string, Contract> = {};

  constructor(
    private prismaService: PrismaService,
    private planService: PlansService,
    private botService: BotsService,
    private logger: LogsService,
  ) {
    this.status = ServiceStatus.READY;

    this.init();
  }

  async init() {
    const allContracts = await this.prismaService.contract.findMany();

    allContracts.forEach((contract) => {
      this.allContracts[contract.id] = contract;
    });
  }

  private parseJSON(value: string) {
    try {
      return JSON.parse(value);
    } catch (err) {
      this.logger.nativeLog({
        severity: 'Error',
        summary: 'autoplans.service>parseJSON',
        details: getReadableError(err),
      });
      return null;
    }
  }

  async addToBlacklist(address: string) {
    const prevBlacklist = await this.prismaService.metadata.findUnique({
      where: {
        key: BLACKLIST_KEY,
      },
    });

    const blacklist = prevBlacklist
      ? this.parseJSON(prevBlacklist.value) || []
      : [];

    blacklist.push(address.toLowerCase());

    await this.prismaService.metadata.upsert({
      where: {
        key: BLACKLIST_KEY,
      },
      create: {
        key: BLACKLIST_KEY,
        value: JSON.stringify(blacklist),
      },
      update: {
        value: JSON.stringify(blacklist),
      },
    });

    return true;
  }

  async removeFromBlacklist(address: string) {
    const prevBlacklist = await this.prismaService.metadata.findUnique({
      where: {
        key: BLACKLIST_KEY,
      },
    });

    const blacklist = (
      prevBlacklist ? this.parseJSON(prevBlacklist.value) || [] : []
    ).filter((item: string) => item.toLowerCase() !== address.toLowerCase());

    await this.prismaService.metadata.upsert({
      where: {
        key: BLACKLIST_KEY,
      },
      create: {
        key: BLACKLIST_KEY,
        value: JSON.stringify(blacklist),
      },
      update: {
        value: JSON.stringify(blacklist),
      },
    });

    return true;
  }

  async getBlacklist(): Promise<string[]> {
    const prevBlacklist = await this.prismaService.metadata.findUnique({
      where: {
        key: BLACKLIST_KEY,
      },
    });

    return prevBlacklist ? this.parseJSON(prevBlacklist.value) || [] : [];
  }

  async addToWhitelist(params: string) {
    const whitelistedTrader = this.parseJSON(
      params,
    ) as WhitelistedTrader | null;

    if (
      !whitelistedTrader ||
      !isAddress(whitelistedTrader.address) ||
      !whitelistedTrader.minR2 ||
      !whitelistedTrader.ratio ||
      !whitelistedTrader.maxSize
    ) {
      throw new Error('Invalid Whitelisted Trader');
    }

    const prevWhitelist = await this.prismaService.metadata.findUnique({
      where: {
        key: WHITELIST_KEY,
      },
    });

    const whitelist = prevWhitelist
      ? this.parseJSON(prevWhitelist.value) || []
      : [];

    whitelist.push(whitelistedTrader);

    await this.prismaService.metadata.upsert({
      where: {
        key: WHITELIST_KEY,
      },
      create: {
        key: WHITELIST_KEY,
        value: JSON.stringify(whitelist),
      },
      update: {
        value: JSON.stringify(whitelist),
      },
    });

    return true;
  }

  async removeFromWhitelist(address: string) {
    const prevWhitelist = await this.prismaService.metadata.findUnique({
      where: {
        key: WHITELIST_KEY,
      },
    });

    const whitelist = (
      prevWhitelist ? this.parseJSON(prevWhitelist.value) || [] : []
    ).filter(
      (item: WhitelistedTrader) =>
        item.address.toLowerCase() !== address.toLowerCase(),
    );

    await this.prismaService.metadata.upsert({
      where: {
        key: WHITELIST_KEY,
      },
      create: {
        key: WHITELIST_KEY,
        value: JSON.stringify(whitelist),
      },
      update: {
        value: JSON.stringify(whitelist),
      },
    });

    return true;
  }

  async getWhitelist(): Promise<string[]> {
    const prevWhitelist = await this.prismaService.metadata.findUnique({
      where: {
        key: WHITELIST_KEY,
      },
    });

    return prevWhitelist
      ? (
          (this.parseJSON(prevWhitelist.value) || []) as WhitelistedTrader[]
        ).map((item) => JSON.stringify(item))
      : [];
  }

  private getExpertPnlSnapshot(
    filter: ExpertFilterParams & {
      whitelistAddress?: string;
    },
    snapshot: PnlSnapshotV2,
    histories: (PerpTradeHistory & { date: Date })[],
  ):
    | (PnlSnapshotV2 & {
        score: number;
        histories: (PerpTradeHistory & { date: Date })[];
      })
    | null {
    // special filers for whitelisted traders only
    if (
      filter.whitelistAddress &&
      filter.whitelistAddress.toLowerCase() !== snapshot.address.toLowerCase()
    ) {
      return null;
    }

    const rangeHistories = histories;

    const oneMonthAgoDate = dayjs().subtract(1, 'month').toDate();

    const totalOpenHistories = rangeHistories.filter(
      (history) => history.operation === 'open',
    );

    const isLatestTrader = totalOpenHistories.find((history) => {
      const historyDate = new Date(history.date);

      return historyDate.getTime() >= oneMonthAgoDate.getTime();
    });

    if (!isLatestTrader) {
      return null;
    }

    if (
      totalOpenHistories.length < filter.minCount ||
      totalOpenHistories.length > filter.maxCount
    ) {
      return null;
    }

    const openHistories = totalOpenHistories.slice(
      Math.max(0, totalOpenHistories.length - 512),
      totalOpenHistories.length,
    );

    const totalSize = openHistories.reduce((acc, history) => {
      return acc + Number(history.collateralInUsd);
    }, 0);

    const avgSize = totalSize / openHistories.length;

    if (avgSize < filter.minAvgSize || avgSize > filter.maxAvgSize) {
      return null;
    }

    const closeHistories = rangeHistories.filter(
      (history) => history.usdPnl !== 0,
    );

    if (closeHistories.length < 6) {
      return null;
    }

    let traderScore = 0;
    const dynamicMinR2 = getMinR2(avgSize, totalOpenHistories.length || 0);

    const minR2 = filter.minR2 || dynamicMinR2;

    for (let step = 0; step < filter.window; step++) {
      let round = 0;
      let stepScore = 0;

      for (let i = 0; i < closeHistories.length; i += filter.window) {
        round++;

        const chunk = closeHistories.slice(
          Math.max(closeHistories.length - i - step - filter.window, 0),
          closeHistories.length - i - step,
        );

        if (chunk.length < 6) {
          continue;
        }

        let pnlSum = 0;

        const pnlArrs: number[] = [];
        const xs: number[] = [];

        for (let j = 0; j < chunk.length; j++) {
          const history = chunk[j];

          pnlSum += +history.usdPnl;

          pnlArrs.push(pnlSum);
          xs.push(j);
        }

        const regression = new SimpleLinearRegression(xs, pnlArrs);
        const score = regression.score(xs, pnlArrs);

        if (Number.isNaN(score.r2)) {
          score.r2 = 1;
        }

        if (score.r2 === Infinity) {
          continue;
        }

        if (regression.slope > 0) {
          if (score.r2 > minR2) {
            stepScore += (regression.slope * score.r2) / round / filter.n;
          } else {
            stepScore +=
              (regression.slope * (score.r2 - 1) * filter.m) / round / filter.n;
          }
        } else {
          stepScore +=
            (regression.slope * (2 - score.r2) * filter.m) / round / filter.n;
        }
      }
      traderScore += stepScore;
    }

    if (traderScore <= filter.minScore) {
      return null;
    }

    return {
      ...snapshot,
      score: (traderScore * closeHistories.length) / filter.window,
      histories,
    };
  }

  async filterExperts(
    platform: Platform,
    dateStr: string,
    after: number | null,
  ): Promise<ExpertPnlSnapshotV2Connection> {
    console.log('filterExperts', platform, dateStr, after);

    const expertMap = new Map<
      string,
      PnlSnapshotV2 & {
        score: number;
        histories: (PerpTradingEventLog & {
          history: PerpTradeHistory;
        })[];
        maxSize: number;
        ratio: number;
      }
    >();

    const lastPnlRecord = after
      ? await this.prismaService.pnlSnapshotV2.findFirst({
          where: {
            id: after,
          },
        })
      : null;

    let currentCursor = lastPnlRecord
      ? {
          id: lastPnlRecord.id,
          accUSDPnl: lastPnlRecord.accUSDPnl,
        }
      : null;
    const limit = 50;

    while (true) {
      console.log('rounded ==>');

      console.time('pnlRecords');

      const pnlRecords: PnlSnapshotV2[] = currentCursor
        ? await this.prismaService.pnlSnapshotV2.findMany({
            take: limit,
            where: {
              dateStr: dateStr,
              platform,
              accUSDPnl: {
                gt: 100,
              },
              kind: PnlSnapshotKind.MONTH,
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
            take: limit,
            where: {
              dateStr: dateStr,
              platform,
              accUSDPnl: {
                gt: 100,
              },
              kind: PnlSnapshotKind.MONTH,
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

      console.timeEnd('pnlRecords');

      if (pnlRecords.length === 0) {
        currentCursor = null;
        break;
      }

      const pnlSnapshotsMap = new Map<string, PnlSnapshotV2[]>();

      const testContracts = await this.prismaService.contract.findMany({
        where: {
          isTestnet: true,
        },
      });

      const testContractIds = testContracts.map((item) => item.id);

      pnlRecords.forEach((record) => {
        const key = JSON.stringify({
          address: record.address,
          platform: record.platform,
        });

        const arr = pnlSnapshotsMap.get(key);

        if (arr) {
          arr.push(record);
        } else {
          pnlSnapshotsMap.set(key, [record]);
        }
      });

      const pnlSnapshotsMapKeys = Array.from(pnlSnapshotsMap.keys());

      const addresses: string[] = pnlSnapshotsMapKeys.map(
        (item) => JSON.parse(item).address,
      );

      const historyRecordsMap = new Map<
        string,
        (PerpTradingEventLog & { history: PerpTradeHistory })[]
      >();

      console.time('historyRecords');

      for (const address of addresses) {
        const records = (
          await this.prismaService.perpTradingEventLog.findMany({
            where: {
              platform,
              address,
            },
            orderBy: [{ date: 'asc' }, { block: 'asc' }, { id: 'asc' }],
          })
        ).filter((item) => !testContractIds.includes(item.contractId));

        records.forEach((record) => {
          const key = record.address;

          const arr = historyRecordsMap.get(key);

          const contract = this.allContracts[record.contractId];

          const history = getWeb3Info(
            contract.platform,
            contract.version,
          ).eventToPerpTradeHistory(
            contract.chainId,
            JSON.parse(record.jsonLog) as any,
          );

          if (!history) {
            return;
          }

          if (arr) {
            arr.push({
              ...record,
              history,
            });
          } else {
            historyRecordsMap.set(key, [
              {
                ...record,
                history,
              },
            ]);
          }
        });
      }

      console.timeEnd('historyRecords');

      const wideFilter = {
        window: 6,
        n: 2,
        m: 1,
        minScore: 10,
        minAvgSize: 0,
        maxAvgSize: 1000_000_000,
        minCount: 0,
        maxCount: 1000_000_000,
        minR2: 0.8,
        ratio: 1,
        maxSize: 700,
      };

      console.time('getExpertPnlSnapshot');

      pnlSnapshotsMapKeys.forEach((key) => {
        const item = JSON.parse(key) as { address: string; contractId: number };

        const subPnlRecords = pnlSnapshotsMap.get(key) || [];
        const allHistories = historyRecordsMap.get(item.address) || [];

        subPnlRecords.forEach((record) => {
          const detail = this.getExpertPnlSnapshot(
            wideFilter,
            record,
            allHistories.map((item) => ({
              ...item.history,
              date: new Date(item.date),
            })),
          );

          if (detail) {
            const key = record.address.toLowerCase();

            const expert = expertMap.get(key);

            if (!expert || expert.score < detail.score) {
              expertMap.set(key, {
                ...detail,
                histories: allHistories,
                maxSize: wideFilter.maxSize,
                ratio: wideFilter.ratio,
              });
            }
          }
        });
      });

      console.timeEnd('getExpertPnlSnapshot');

      currentCursor = {
        id: pnlRecords[pnlRecords.length - 1].id,
        accUSDPnl: pnlRecords[pnlRecords.length - 1].accUSDPnl,
      };

      const keys = Array.from(expertMap.keys());

      // chunk by 30 for ux
      if (keys.length >= 5) {
        break;
      }
    }

    const edges = Array.from(expertMap.values())
      .sort((a, b) => b.score - a.score)
      .map((expert) => {
        let openedPositions = 0;
        let totalDuration = 0;
        let totalPositions = 0;
        let sumOfPnl = 0;
        let sumOfSize = 0;

        const groupedByPositionKey: Record<
          string,
          (PerpTradingEventLog & { history: PerpTradeHistory })[]
        > = {};

        expert.histories.forEach((item) => {
          const history = item.history;

          if (!history) {
            return;
          }

          if (groupedByPositionKey[history.positionKey]) {
            groupedByPositionKey[history.positionKey].push(item);
          } else {
            groupedByPositionKey[history.positionKey] = [item];
          }
        });

        for (const histories of Object.values(groupedByPositionKey)) {
          for (let i = 0; i < histories.length; i++) {
            const history = histories[i].history;

            if (history.operation !== 'open') {
              continue;
            }

            openedPositions++;
            totalPositions++;

            sumOfSize += history.sizeInUsd;

            for (let j = i; j < histories.length; j++) {
              const nextHistory = histories[j].history;

              sumOfPnl += +nextHistory.usdPnl;

              if (nextHistory.operation === 'close') {
                openedPositions--;

                totalDuration +=
                  histories[j].date.getTime() - histories[i].date.getTime();
                break;
              }
            }
          }
        }

        const avgDuration =
          totalPositions > 0 ? totalDuration / totalPositions : 0;

        return {
          cursor: expert.id,
          node: {
            ...expert,
            openedPositions,
            avgDuration,
            avgPnlRatio:
              sumOfSize > 0 ? (sumOfPnl / sumOfSize) * 100 : 1000_000_000,
          },
        };
      });

    return {
      edges,
      pageInfo: {
        hasNextPage: currentCursor !== null,
        endCursor: currentCursor ? currentCursor.id : null,
      },
    };
  }

  private async filterExpertsForPlans(
    platform: Platform,
    dateStr: string,
    cursor: number | null,
    limit: number,
  ): Promise<{
    lastCursor: number | null;
    realExpertPnlSnapshots: (Omit<
      ExpertPnlSnapshotV2,
      'avgDuration' | 'avgPnlRatio' | 'openedPositions' | 'histories'
    > & {
      histories: (PerpTradeHistory & { date: Date })[];
      maxSize: number;
      ratio: number;
      lastCount?: number;
      ignoreMinPnlLimit?: boolean;
      ignoreMinDurationLimit?: boolean;
    })[];
  }> {
    const lastPnlRecord = cursor
      ? await this.prismaService.pnlSnapshotV2.findFirst({
          where: {
            id: cursor,
          },
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
          take: limit,
          where: {
            dateStr: dateStr,
            accUSDPnl: {
              gt: 100,
            },
            kind: PnlSnapshotKind.MONTH,
            platform,
            OR: [
              {
                accUSDPnl: {
                  gt: currentCursor.accUSDPnl,
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
          take: limit,
          where: {
            dateStr: dateStr,
            accUSDPnl: {
              gt: 100,
            },
            kind: PnlSnapshotKind.MONTH,
            platform,
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
      return {
        lastCursor: null,
        realExpertPnlSnapshots: [],
      };
    }

    const pnlSnapshotsMap = new Map<string, PnlSnapshotV2[]>();

    const testContracts = await this.prismaService.contract.findMany({
      where: {
        isTestnet: true,
      },
    });

    const testContractIds = testContracts.map((item) => item.id);

    pnlRecords.forEach((record) => {
      const key = JSON.stringify({
        address: record.address,
        platform: record.platform,
      });

      const arr = pnlSnapshotsMap.get(key);

      if (arr) {
        arr.push(record);
      } else {
        pnlSnapshotsMap.set(key, [record]);
      }
    });

    const pnlSnapshotsMapKeys = Array.from(pnlSnapshotsMap.keys());

    const historyRecords =
      await this.prismaService.perpTradingEventLog.findMany({
        where: {
          OR: [
            ...pnlSnapshotsMapKeys
              .map(
                (item) =>
                  JSON.parse(item) as { address: string; platform: Platform },
              )
              .map((item) => ({
                address: item.address,
                platform: item.platform,
                contractId: {
                  notIn: testContractIds,
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
          {
            id: 'asc',
          },
        ],
      });

    const historyRecordsMap = new Map<
      string,
      (PerpTradingEventLog & { history: PerpTradeHistory })[]
    >();

    const expertMap = new Map<
      string,
      PnlSnapshotV2 & {
        score: number;
        histories: (PerpTradeHistory & { date: Date })[];
        maxSize: number;
        ratio: number;
        lastCount?: number;
        ignoreMinPnlLimit?: boolean;
        ignoreMinDurationLimit?: boolean;
      }
    >();

    historyRecords.forEach((record) => {
      const key = record.address;

      const arr = historyRecordsMap.get(key);

      const contract = this.allContracts[record.contractId];

      const history = getWeb3Info(
        contract.platform,
        contract.version,
      ).eventToPerpTradeHistory(
        contract.chainId,
        JSON.parse(record.jsonLog) as any,
      );

      if (!history) {
        return;
      }

      if (arr) {
        arr.push({
          ...record,
          history,
        });
      } else {
        historyRecordsMap.set(key, [
          {
            ...record,
            history,
          },
        ]);
      }
    });

    const whitelist = await this.getWhitelist();

    const whitelistFilters = whitelist.map((item) => {
      const params = JSON.parse(item) as WhitelistedTrader;

      return {
        window: 6,
        n: 2,
        m: 1,
        minScore: 10,
        minAvgSize: 0,
        maxAvgSize: 1000_000_000,
        minCount: 0,
        maxCount: 1000_000_000,
        minR2: params.minR2,
        ratio: params.ratio,
        maxSize: params.maxSize,
        whitelistAddress: params.address,
        lastCount: params.lastCount,
        ignoreMinPnlLimit: params.ignoreMinPnlLimit,
        ignoreMinDurationLimit: params.ignoreMinDurationLimit,
      };
    });

    pnlSnapshotsMapKeys.forEach((key) => {
      const item = JSON.parse(key) as { address: string; contractId: number };

      const subPnlRecords = pnlSnapshotsMap.get(key) || [];
      const allHistories = historyRecordsMap.get(item.address) || [];

      subPnlRecords.forEach((record) => {
        for (const filter of whitelistFilters) {
          const detail = this.getExpertPnlSnapshot(
            filter,
            record,
            allHistories.map((item) => ({
              ...item.history,
              date: new Date(item.date),
            })),
          );

          if (detail) {
            const key = record.address.toLowerCase();

            const expert = expertMap.get(key);

            if (!expert || expert.score < detail.score) {
              expertMap.set(key, {
                ...detail,
                maxSize: filter.maxSize,
                ratio: filter.ratio,
                lastCount: filter.lastCount,
                ignoreMinPnlLimit: filter.ignoreMinPnlLimit,
                ignoreMinDurationLimit: filter.ignoreMinDurationLimit,
              });
            }
          }
        }
      });
    });

    return {
      lastCursor: pnlRecords[pnlRecords.length - 1].id,
      realExpertPnlSnapshots: Array.from(expertMap.values()).sort(
        (a, b) => b.score - a.score,
      ),
    };
  }

  private async createPlan(user: User, platform: Platform): Promise<boolean> {
    try {
      if (user.followerContractId === 0) {
        throw new Error('Invalid User');
      }

      const planInput: CreatePlanInput = {
        title: `Auto Plan For ${platform}`,
        description: `This is an auto plan for ${platform}`,
        scheduledStart: dayjs(new Date()).add(5, 'minutes').toDate(),
        scheduledEnd: dayjs(new Date())
          .add(3, 'hours')
          .add(5, 'minutes')
          .toDate(),
      };

      const plan = await this.planService.create(
        user.address.toLowerCase(),
        planInput,
      );

      if (!plan) {
        throw new Error('Cannot create a plan');
      }

      const contracts = await this.prismaService.contract.findMany({
        where: {
          platform,
          isTestnet: false,
          status: ContractStatus.Live,
        },
      });

      const botInputs: CreateBotAndStrategyInput[] = [];

      const blacklist = await this.getBlacklist();

      const allFollowers = await this.prismaService.follower.findMany();
      const followerAddresses = allFollowers.map((item) =>
        item.address.toLowerCase(),
      );

      let cursor = null;
      let pages = 1;
      const limit = 100;

      const dateStr = dayjs().format('YYYY-MM-DD');

      while (true) {
        const { lastCursor, realExpertPnlSnapshots } =
          await this.filterExpertsForPlans(platform, dateStr, cursor, limit);

        this.logger.log({
          severity: 'Info',
          summary: 'AutoPlansServiceV2>createPlan',
          details: `[AutoPlansServiceV2] ${dateStr} ${pages * limit} ~ ${(pages + 1) * limit} ${realExpertPnlSnapshots.length} experts`,
        });

        if (!lastCursor) {
          break;
        }

        for (let i = 0; i < realExpertPnlSnapshots.length; i++) {
          const expert = realExpertPnlSnapshots[i];

          if (followerAddresses.includes(expert.address.toLowerCase())) {
            continue;
          }

          if (blacklist.includes(expert.address.toLowerCase())) {
            continue;
          }

          let openedPositions = 0;
          let totalDuration = 0;
          let totalPositions = 0;
          let sumOfPnl = 0;
          let sumOfSize = 0;
          let totalLeverage = 0;
          let openCount = 0;

          const groupedByPositionKey: Record<
            string,
            (PerpTradeHistory & { date: Date })[]
          > = {};

          expert.histories
            .slice(
              Math.max(0, expert.histories.length - (expert.lastCount || 512)),
              expert.histories.length,
            )
            .forEach((history) => {
              if (groupedByPositionKey[history.positionKey]) {
                groupedByPositionKey[history.positionKey].push(history);
              } else {
                groupedByPositionKey[history.positionKey] = [history];
              }
            });

          for (const histories of Object.values(groupedByPositionKey)) {
            for (let i = 0; i < histories.length; i++) {
              const history = histories[i];

              if (history.operation !== 'open') {
                continue;
              }

              openedPositions++;
              totalPositions++;

              sumOfSize += history.sizeInUsd;

              if (!DEGEN_PAIRS.includes(history.pair.toUpperCase())) {
                totalLeverage += +history.leverage;
                openCount++;
              }

              for (let j = i; j < histories.length; j++) {
                const nextHistory = histories[j];

                sumOfPnl += +nextHistory.usdPnl;

                if (nextHistory.operation === 'close') {
                  openedPositions--;

                  totalDuration +=
                    nextHistory.date.getTime() - history.date.getTime();
                  break;
                }
              }
            }
          }

          const avgDuration =
            totalPositions > 0 ? totalDuration / totalPositions : 0;

          // if trader holds too many positions, skip
          if (openedPositions > 10) {
            continue;
          }

          const avgLeverage = openCount > 0 ? totalLeverage / openCount : 0;

          // if trader is a shorterm trader, skip
          if (avgDuration < 1000 * 3 * 60 && !expert.ignoreMinDurationLimit) {
            continue;
          }

          if (sumOfSize > 0 && !expert.ignoreMinPnlLimit) {
            const avgPnlP = (sumOfPnl / sumOfSize) * 100;

            if (avgPnlP < 0.5) {
              continue;
            }
          }

          for (const contract of contracts) {
            botInputs.push({
              planId: plan.id,
              followerContractId: user.followerContractId,
              leaderAddress: expert.address,
              leaderCollateralBaseline: 0,
              leaderContractId: contract.id,
              strategy: {
                strategyKey: 'ratioCopy',
                ratio: expert.ratio,
                lifeTime: 365 * 24 * 60,
                maxCollateral: expert.maxSize,
                minCollateral: 5,
                collateralBaseline: 0,
                maxLeverage: Math.max(
                  1100,
                  Math.ceil(1.3 * avgLeverage * 1000),
                ),
                minLeverage: 1100,
                params: '{}',
              },
            });
          }
        }

        cursor = lastCursor;
        pages++;
      }

      await this.botService.batchCreateBots(
        user.address.toLowerCase(),
        botInputs,
      );

      return true;
    } catch (err) {
      this.logger.log({
        severity: 'Error',
        summary: 'AutoPlansServiceV2>createPlan',
        details: `[AutoPlansService] error: ${getReadableError(err as Error)}`,
      });

      return false;
    }
  }

  async createAutoPlans() {
    this.status = ServiceStatus.PROCESS;

    const dateStr = dayjs().format('YYYY-MM-DD');

    try {
      this.logger.log({
        severity: 'Info',
        summary: 'AutoPlansServiceV2>createAutoPlans',
        details: `[AutoPlansService] ${dateStr}`,
      });

      const autoAllowedUsers = await this.prismaService.user.findMany({
        where: {
          permission: {
            in: [UserPermission.Trader, UserPermission.Admin],
          },
          allowAuto: true,
        },
      });

      for (const user of autoAllowedUsers) {
        for (const platform of Object.values(Platform)) {
          await this.createPlan(user, platform);
        }
      }
    } catch (error) {
      this.logger.log({
        severity: 'Error',
        summary: 'AutoPlansServiceV2>createAutoPlans',
        details: `[AutoPlansService] ${dateStr} error: ${getReadableError(
          error as Error,
        )}`,
      });
    }

    this.status = ServiceStatus.READY;
  }

  async createAutoPlansForUser(userId: string) {
    const dateStr = dayjs().format('YYYY-MM-DD');

    try {
      this.logger.log({
        severity: 'Info',
        summary: 'AutoPlansServiceV2>createAutoPlansForUser',
        details: `[AutoPlansServiceV2] ${dateStr}`,
      });

      const user = await this.prismaService.user.findUnique({
        where: {
          address: userId,
          permission: {
            in: [UserPermission.Trader, UserPermission.Admin],
          },
          allowAuto: true,
        },
      });

      if (!user) {
        throw new Error('Invalid User');
      }

      for (const platform of Object.values(Platform)) {
        await this.createPlan(user, platform);
      }

      return true;
    } catch (error) {
      this.logger.log({
        severity: 'Error',
        summary: 'AutoPlansServiceV2>createAutoPlansForUser',
        details: `[AutoPlansServiceV2] ${dateStr} error: ${getReadableError(
          error as Error,
        )}`,
      });

      return false;
    }
  }
}

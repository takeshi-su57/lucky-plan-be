import { Injectable } from '@nestjs/common';
import {
  PnlSnapshotKind,
  PnlSnapshot,
  TradeHistory,
  TradeActionType,
  UserPermission,
  User,
} from '@prisma/client';
import * as dayjs from 'dayjs';
import { SimpleLinearRegression } from 'ml-regression-simple-linear';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/loggers/logs.service';

import { getReadableError } from 'src/utils';
import { CreatePlanInput } from './dto/plan.input';
import { CreateBotAndStrategyInput } from 'src/bots/dto/bot.input';
import { PlansService } from './plans.service';
import { BotsService } from 'src/bots/bots.service';
import { TradingVariableService } from 'src/global/trading-variable.service';

import { bestFilters, ExpertFilterParams } from './expert-filters/v2.2';

import { Pair } from 'src/types';
import { ExpertPnlSnapshot } from './entities/plan.entity';
import { isAddress } from 'viem';

export type ServiceStatus = 'process' | 'ready';

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
export class AutoPlansV2Service {
  status: ServiceStatus = 'ready';

  constructor(
    private prismaService: PrismaService,
    private tradingVariableService: TradingVariableService,
    private planService: PlansService,
    private botService: BotsService,
    private logger: LogsService,
  ) {
    this.status = 'ready';
  }

  private parseJSON(value: string) {
    try {
      return JSON.parse(value);
    } catch {
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
    snapshot: PnlSnapshot,
    histories: TradeHistory[],
  ): (PnlSnapshot & { score: number; histories: TradeHistory[] }) | null {
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
      (history) =>
        history.action === TradeActionType.TradeOpenedMarket ||
        history.action === TradeActionType.TradeOpenedLimit,
    );

    const isLatestTrader = totalOpenHistories.find((history) => {
      const historyDate = new Date(history.date);

      return historyDate.getTime() >= oneMonthAgoDate.getTime();
    });

    if (!isLatestTrader) {
      return null;
    }

    if (
      !filter.whitelistAddress &&
      (totalOpenHistories.length < filter.minCount ||
        totalOpenHistories.length > filter.maxCount)
    ) {
      return null;
    }

    const openHistories = totalOpenHistories.reverse().slice(0, 512);

    const totalSize = openHistories.reduce((acc, history) => {
      return acc + Number(history.size) * Number(history.collateralPriceUsd);
    }, 0);

    const avgSize = totalSize / openHistories.length;

    if (
      !filter.whitelistAddress &&
      (avgSize < filter.minAvgSize || avgSize > filter.maxAvgSize)
    ) {
      return null;
    }

    const closeHistories = rangeHistories
      .filter((history) => {
        return (
          history.action === TradeActionType.TradeClosedMarket ||
          history.action === TradeActionType.TradeClosedLIQ ||
          history.action === TradeActionType.TradeClosedSL ||
          history.action === TradeActionType.TradeClosedTP ||
          history.action === TradeActionType.TradePosSizeIncrease ||
          history.action === TradeActionType.TradePosSizeDecrease
        );
      })
      .filter((history) => +history.pnl !== 0);

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

          pnlSum += +history.pnl * +history.collateralPriceUsd;

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

  async filterExperts(dateStr: string): Promise<ExpertPnlSnapshot[]> {
    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        where: {
          dateStr: dateStr,
          accUSDPnl: {
            gt: 100,
          },
          kind: PnlSnapshotKind.MONTH,
          contractId: 0,
        },
        orderBy: {
          accUSDPnl: 'desc',
        },
      });

    const pnlSnapshotsMap = new Map<string, PnlSnapshot[]>();

    pnlRecords.forEach((record) => {
      // if (record.contractId === 0) {
      //   return;
      // }

      const key = JSON.stringify({
        address: record.address,
        contractId: record.contractId,
      });

      const arr = pnlSnapshotsMap.get(key);

      if (arr) {
        arr.push(record);
      } else {
        pnlSnapshotsMap.set(key, [record]);
      }
    });

    const pnlSnapshotsMapKeys = Array.from(pnlSnapshotsMap.keys());

    const historyRecords = await this.prismaService.tradeHistory.findMany({
      where: {
        OR: [
          ...pnlSnapshotsMapKeys
            .map(
              (item) =>
                JSON.parse(item) as { address: string; contractId: number },
            )
            .map((item) => ({
              address: item.address,
              ...(item.contractId !== 0
                ? { contractId: item.contractId }
                : { contractId: { not: 4 } }),
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

    const expertMap = new Map<
      string,
      PnlSnapshot & {
        score: number;
        histories: TradeHistory[];
        maxSize: number;
        ratio: number;
      }
    >();

    historyRecords.forEach((record) => {
      const key = record.address;

      const arr = historyRecordsMap.get(key);

      if (arr) {
        arr.push(record);
      } else {
        historyRecordsMap.set(key, [record]);
      }
    });

    const wideFilter = {
      window: 6,
      n: 2,
      m: 1,
      minScore: 10,
      minAvgSize: 0,
      maxAvgSize: 1000_000_000,
      minCount: 0,
      maxCount: 1000_000_000,
      minR2: 0.7,
      ratio: 1,
      maxSize: 700,
    };

    pnlSnapshotsMapKeys.forEach((key) => {
      const item = JSON.parse(key) as { address: string; contractId: number };

      const subPnlRecords = pnlSnapshotsMap.get(key) || [];
      const allHistories = historyRecordsMap.get(item.address) || [];

      subPnlRecords.forEach((record) => {
        const detail = this.getExpertPnlSnapshot(
          wideFilter,
          record,
          allHistories,
        );

        if (detail) {
          const key = record.address.toLowerCase();

          const expert = expertMap.get(key);

          if (!expert || expert.score < detail.score) {
            expertMap.set(key, {
              ...detail,
              maxSize: wideFilter.maxSize,
              ratio: wideFilter.ratio,
            });
          }
        }
      });
    });

    const contracts = await this.prismaService.contract.findMany({
      where: {
        isTestnet: false,
        id: {
          not: 4,
        },
      },
    });

    const pairMap = new Map<string, Pair>();

    for (const contract of contracts) {
      this.tradingVariableService.getPairs(contract.id).forEach((pair) => {
        if (pair) {
          pairMap.set(
            `${contract.id}-${pair.from}/${pair.to}`.toLowerCase(),
            pair,
          );
        }
      });
    }

    return Array.from(expertMap.values())
      .sort((a, b) => b.score - a.score)
      .map((expert) => {
        const openedHistories = new Map<string, boolean>();
        const pnlMaps = new Map<string, number>();
        const sizeMaps = new Map<string, number>();
        const durationMaps = new Map<
          string,
          { min: number | null; max: number }
        >();

        expert.histories.forEach((item) => {
          if (
            item.action === TradeActionType.TradeOpenedMarket ||
            item.action === TradeActionType.TradeOpenedLimit
          ) {
            openedHistories.set(`${item.contractId}-${item.tradeIndex}`, true);

            durationMaps.set(`${item.contractId}-${item.tradeIndex}`, {
              min: item.date.getTime(),
              max: Date.now(),
            });
          }

          if (
            item.action === TradeActionType.TradeClosedMarket ||
            item.action === TradeActionType.TradeClosedLIQ ||
            item.action === TradeActionType.TradeClosedSL ||
            item.action === TradeActionType.TradeClosedTP
          ) {
            openedHistories.set(`${item.contractId}-${item.tradeIndex}`, false);

            const prevDuration = durationMaps.get(
              `${item.contractId}-${item.tradeIndex}`,
            );

            durationMaps.set(`${item.contractId}-${item.tradeIndex}`, {
              min: prevDuration?.min || null,
              max: item.date.getTime(),
            });
          }

          const prevPnl =
            pnlMaps.get(`${item.contractId}-${item.tradeIndex}`) || 0;

          pnlMaps.set(
            `${item.contractId}-${item.tradeIndex}`,
            prevPnl + +item.pnl * +item.collateralPriceUsd,
          );

          const prevSize =
            sizeMaps.get(`${item.contractId}-${item.tradeIndex}`) || 0;

          sizeMaps.set(
            `${item.contractId}-${item.tradeIndex}`,
            Math.max(
              prevSize,
              +item.size * +item.collateralPriceUsd * +item.leverage,
            ),
          );
        });

        const openedHistoriesArr = Array.from(openedHistories.entries())
          .filter((item) => item[1])
          .map((item) => item[0]);

        const chunkForPnlHistories = expert.histories
          .filter((item) => {
            const pair = pairMap.get(
              `${item.contractId}-${item.pair}`.toLowerCase(),
            );

            if (!pair) {
              return false;
            }

            return (
              pair.depth.onePercentDepthAboveUsd > 0n &&
              pair.depth.onePercentDepthBelowUsd > 0n
            );
          })
          .reverse()
          .slice(0, 512);

        let totalDuration = 0;
        let durationCount = 0;

        expert.histories
          .reverse()
          .slice(0, 512)
          .filter(
            (history) =>
              history.action === TradeActionType.TradeClosedMarket ||
              history.action === TradeActionType.TradeClosedLIQ ||
              history.action === TradeActionType.TradeClosedSL ||
              history.action === TradeActionType.TradeClosedTP,
          )
          .forEach((item) => {
            const duration = durationMaps.get(
              `${item.contractId}-${item.tradeIndex}`,
            );

            if (duration && duration.min && duration.max) {
              totalDuration += duration.max - duration.min;
              durationCount++;
            }
          });

        let sumOfPnl = 0;
        let sumOfSize = 0;

        chunkForPnlHistories
          .filter(
            (history) =>
              history.action === TradeActionType.TradeClosedMarket ||
              history.action === TradeActionType.TradeClosedLIQ ||
              history.action === TradeActionType.TradeClosedSL ||
              history.action === TradeActionType.TradeClosedTP,
          )
          .map((item) => {
            const pnl =
              pnlMaps.get(`${item.contractId}-${item.tradeIndex}`) || 0;
            const size =
              sizeMaps.get(`${item.contractId}-${item.tradeIndex}`) || 0;

            sumOfPnl += pnl;
            sumOfSize += size;
          });

        const avgDuration =
          durationCount > 0 ? totalDuration / durationCount : 0;

        return {
          ...expert,
          openedPositions: openedHistoriesArr.length,
          avgDuration,
          avgPnlRatio: sumOfSize > 0 ? sumOfPnl / sumOfSize : 1000_000_000,
        };
      });
  }

  private async filterExpertsForPlans(
    dateStr: string,
  ): Promise<
    Omit<ExpertPnlSnapshot, 'avgDuration' | 'avgPnlRatio' | 'openedPositions'>[]
  > {
    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        where: {
          dateStr: dateStr,
          accUSDPnl: {
            gt: 100,
          },
          kind: PnlSnapshotKind.MONTH,
          contractId: 0,
        },
        orderBy: {
          accUSDPnl: 'desc',
        },
      });

    const pnlSnapshotsMap = new Map<string, PnlSnapshot[]>();

    pnlRecords.forEach((record) => {
      // if (record.contractId === 0) {
      //   return;
      // }

      const key = JSON.stringify({
        address: record.address,
        contractId: record.contractId,
      });

      const arr = pnlSnapshotsMap.get(key);

      if (arr) {
        arr.push(record);
      } else {
        pnlSnapshotsMap.set(key, [record]);
      }
    });

    const pnlSnapshotsMapKeys = Array.from(pnlSnapshotsMap.keys());

    const historyRecords = await this.prismaService.tradeHistory.findMany({
      where: {
        OR: [
          ...pnlSnapshotsMapKeys
            .map(
              (item) =>
                JSON.parse(item) as { address: string; contractId: number },
            )
            .map((item) => ({
              address: item.address,
              ...(item.contractId !== 0
                ? { contractId: item.contractId }
                : { contractId: { not: 4 } }),
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

    const expertMap = new Map<
      string,
      PnlSnapshot & {
        score: number;
        histories: TradeHistory[];
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

      if (arr) {
        arr.push(record);
      } else {
        historyRecordsMap.set(key, [record]);
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
        for (const filter of [...bestFilters, ...whitelistFilters]) {
          const detail = this.getExpertPnlSnapshot(
            filter,
            record,
            allHistories,
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

    return Array.from(expertMap.values()).sort((a, b) => b.score - a.score);
  }

  private async createPlan(
    user: User,
    realExpertPnlSnapshots: (PnlSnapshot & {
      score: number;
      histories: TradeHistory[];
      maxSize: number;
      ratio: number;
      lastCount?: number;
      ignoreMinPnlLimit?: boolean;
      ignoreMinDurationLimit?: boolean;
    })[],
  ): Promise<boolean> {
    try {
      if (user.followerContractId === 0) {
        throw new Error('Invalid User');
      }

      if (realExpertPnlSnapshots.length === 0) {
        throw new Error('No expert pnl snapshots');
      }

      const planInput: CreatePlanInput = {
        title: 'Auto Plan V2',
        description: 'This is an auto plan',
        scheduledStart: new Date(),
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
          isTestnet: false,
          id: {
            not: 4,
          },
        },
      });

      const pairMap = new Map<string, Pair>();

      for (const contract of contracts) {
        this.tradingVariableService.getPairs(contract.id).forEach((pair) => {
          if (pair) {
            pairMap.set(
              `${contract.id}-${pair.from}/${pair.to}`.toLowerCase(),
              pair,
            );
          }
        });
      }

      const botInputs: CreateBotAndStrategyInput[] = [];

      const blacklist = await this.getBlacklist();

      for (let i = 0; i < realExpertPnlSnapshots.length; i++) {
        const expert = realExpertPnlSnapshots[i];

        if (blacklist.includes(expert.address.toLowerCase())) {
          continue;
        }

        const openedHistories = new Map<string, boolean>();
        const pnlMaps = new Map<string, number>();
        const sizeMaps = new Map<string, number>();
        const durationMaps = new Map<
          string,
          { min: number | null; max: number }
        >();

        expert.histories.forEach((item) => {
          if (
            item.action === TradeActionType.TradeOpenedMarket ||
            item.action === TradeActionType.TradeOpenedLimit
          ) {
            openedHistories.set(`${item.contractId}-${item.tradeIndex}`, true);

            durationMaps.set(`${item.contractId}-${item.tradeIndex}`, {
              min: item.date.getTime(),
              max: Date.now(),
            });
          }

          if (
            item.action === TradeActionType.TradeClosedMarket ||
            item.action === TradeActionType.TradeClosedLIQ ||
            item.action === TradeActionType.TradeClosedSL ||
            item.action === TradeActionType.TradeClosedTP
          ) {
            openedHistories.set(`${item.contractId}-${item.tradeIndex}`, false);

            const prevDuration = durationMaps.get(
              `${item.contractId}-${item.tradeIndex}`,
            );

            durationMaps.set(`${item.contractId}-${item.tradeIndex}`, {
              min: prevDuration?.min || null,
              max: item.date.getTime(),
            });
          }

          const prevPnl =
            pnlMaps.get(`${item.contractId}-${item.tradeIndex}`) || 0;

          pnlMaps.set(
            `${item.contractId}-${item.tradeIndex}`,
            prevPnl + +item.pnl * +item.collateralPriceUsd,
          );

          const prevSize =
            sizeMaps.get(`${item.contractId}-${item.tradeIndex}`) || 0;

          sizeMaps.set(
            `${item.contractId}-${item.tradeIndex}`,
            Math.max(
              prevSize,
              +item.size * +item.collateralPriceUsd * +item.leverage,
            ),
          );
        });

        const openedHistoriesArr = Array.from(openedHistories.entries())
          .filter((item) => item[1])
          .map((item) => item[0]);

        // if trader holds too many positions, skip
        if (openedHistoriesArr.length > 15) {
          continue;
        }

        const chunkForPnlHistories = expert.histories
          .filter((item) => {
            const pair = pairMap.get(
              `${item.contractId}-${item.pair}`.toLowerCase(),
            );

            if (!pair) {
              return false;
            }

            return (
              pair.depth.onePercentDepthAboveUsd > 0n &&
              pair.depth.onePercentDepthBelowUsd > 0n
            );
          })
          .reverse()
          .slice(0, expert.lastCount || 512);

        let totalDuration = 0;
        let durationCount = 0;

        expert.histories
          .reverse()
          .slice(0, expert.lastCount || 512)
          .filter(
            (history) =>
              history.action === TradeActionType.TradeClosedMarket ||
              history.action === TradeActionType.TradeClosedLIQ ||
              history.action === TradeActionType.TradeClosedSL ||
              history.action === TradeActionType.TradeClosedTP,
          )
          .forEach((item) => {
            const duration = durationMaps.get(
              `${item.contractId}-${item.tradeIndex}`,
            );

            if (duration && duration.min && duration.max) {
              totalDuration += duration.max - duration.min;
              durationCount++;
            }
          });

        let totalLeverage = 0;
        let openCount = 0;

        expert.histories
          .reverse()
          .filter(
            (history) =>
              history.action === TradeActionType.TradeOpenedMarket ||
              history.action === TradeActionType.TradeOpenedLimit,
          )
          .slice(0, expert.lastCount || 512)
          .forEach((item) => {
            if (DEGEN_PAIRS.includes(item.pair.toUpperCase())) {
              return;
            }

            totalLeverage += +item.leverage;
            openCount++;
          });

        const avgLeverage = openCount > 0 ? totalLeverage / openCount : 0;

        let sumOfPnl = 0;
        let sumOfSize = 0;

        chunkForPnlHistories
          .filter(
            (history) =>
              history.action === TradeActionType.TradeClosedMarket ||
              history.action === TradeActionType.TradeClosedLIQ ||
              history.action === TradeActionType.TradeClosedSL ||
              history.action === TradeActionType.TradeClosedTP,
          )
          .forEach((item) => {
            const pnl =
              pnlMaps.get(`${item.contractId}-${item.tradeIndex}`) || 0;
            const size =
              sizeMaps.get(`${item.contractId}-${item.tradeIndex}`) || 0;

            sumOfPnl += pnl;
            sumOfSize += size;
          });

        const avgDuration =
          durationCount > 0 ? totalDuration / durationCount : 0;

        // if trader is a shorterm trader, skip
        if (avgDuration < 1000 * 3 * 60 && !expert.ignoreMinDurationLimit) {
          continue;
        }

        if (sumOfSize > 0 && !expert.ignoreMinPnlLimit) {
          const avgPnlP = sumOfPnl / sumOfSize;

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
              maxLeverage: Math.max(1100, Math.ceil(1.3 * avgLeverage * 1000)),
              minLeverage: 1100,
              params: '{}',
            },
          });
        }
      }

      await this.botService.batchCreateBots(
        user.address.toLowerCase(),
        botInputs,
      );

      return true;
    } catch (err) {
      this.logger.log({
        severity: 'Error',
        summary: 'AutoPlansService>createPlan',
        details: `[AutoPlansService] error: ${getReadableError(err as Error)}`,
      });

      return false;
    }
  }

  async createAutoPlans() {
    this.status = 'process';

    const dateStr = dayjs().format('YYYY-MM-DD');

    try {
      const allExpertPnlSnapshots = await this.filterExpertsForPlans(dateStr);
      const allFollowers = await this.prismaService.follower.findMany();
      const followerAddresses = allFollowers.map((item) =>
        item.address.toLowerCase(),
      );

      const realExpertPnlSnapshots = allExpertPnlSnapshots.filter(
        (snapshot) =>
          !followerAddresses.includes(snapshot.address.toLowerCase()),
      );

      this.logger.log({
        severity: 'Info',
        summary: 'AutoPlansService>createAutoPlans',
        details: `[AutoPlansService] ${dateStr} expertPnlSnapshots: ${realExpertPnlSnapshots.length}`,
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
        await this.createPlan(user, realExpertPnlSnapshots);
      }
    } catch (error) {
      this.logger.log({
        severity: 'Error',
        summary: 'AutoPlansService>createAutoPlans',
        details: `[AutoPlansService] ${dateStr} error: ${getReadableError(
          error as Error,
        )}`,
      });
    }

    this.status = 'ready';
  }

  async createAutoPlansForUser(userId: string) {
    const dateStr = dayjs().format('YYYY-MM-DD');

    try {
      const allExpertPnlSnapshots = await this.filterExpertsForPlans(dateStr);
      const allFollowers = await this.prismaService.follower.findMany();
      const followerAddresses = allFollowers.map((item) =>
        item.address.toLowerCase(),
      );

      const realExpertPnlSnapshots = allExpertPnlSnapshots.filter(
        (snapshot) =>
          !followerAddresses.includes(snapshot.address.toLowerCase()),
      );

      this.logger.log({
        severity: 'Info',
        summary: 'AutoPlansService>createAutoPlansForUser',
        details: `[AutoPlansService] ${dateStr} expertPnlSnapshots: ${realExpertPnlSnapshots.length}`,
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

      return await this.createPlan(user, realExpertPnlSnapshots);
    } catch (error) {
      this.logger.log({
        severity: 'Error',
        summary: 'AutoPlansService>createAutoPlansForUser',
        details: `[AutoPlansService] ${dateStr} error: ${getReadableError(
          error as Error,
        )}`,
      });

      return false;
    }
  }
}

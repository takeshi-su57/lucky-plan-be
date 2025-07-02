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

import { bestFilters, ExpertFilterParams } from './expert-filters/v2.1';

import { Pair } from 'src/types';

export type ServiceStatus = 'process' | 'ready';

const blacklist = ['0xfe2bc280ee8ce7f2cbe2c3ff71514864ecf8a776'];

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

  private getExpertPnlSnapshot(
    filter: ExpertFilterParams,
    snapshot: PnlSnapshot,
    histories: TradeHistory[],
  ): (PnlSnapshot & { score: number; histories: TradeHistory[] }) | null {
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

    if (
      !isLatestTrader ||
      totalOpenHistories.length < filter.minCount ||
      totalOpenHistories.length > filter.maxCount
    ) {
      return null;
    }

    const openHistories = totalOpenHistories.reverse().slice(0, 512);

    const totalSize = openHistories.reduce((acc, history) => {
      return acc + Number(history.size) * Number(history.collateralPriceUsd);
    }, 0);

    const avgSize = totalSize / openHistories.length;

    if (avgSize < filter.minAvgSize || avgSize > filter.maxAvgSize) {
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
          if (score.r2 > filter.minR2) {
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

  private async filterExperts(dateStr: string): Promise<
    (PnlSnapshot & {
      score: number;
      histories: TradeHistory[];
      maxSize: number;
      ratio: number;
    })[]
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

    pnlSnapshotsMapKeys.forEach((key) => {
      const item = JSON.parse(key) as { address: string; contractId: number };

      const subPnlRecords = pnlSnapshotsMap.get(key) || [];
      const allHistories = historyRecordsMap.get(item.address) || [];

      subPnlRecords.forEach((record) => {
        for (const filter of bestFilters) {
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
          .add(15, 'minutes')
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

      for (let i = 0; i < realExpertPnlSnapshots.length; i++) {
        const expert = realExpertPnlSnapshots[i];

        if (blacklist.includes(expert.address.toLowerCase())) {
          continue;
        }

        const openedHistories = new Map<number, boolean>();
        const pnlMaps = new Map<number, number>();
        const sizeMaps = new Map<number, number>();

        expert.histories.forEach((item) => {
          if (
            item.action === TradeActionType.TradeOpenedMarket ||
            item.action === TradeActionType.TradeOpenedLimit
          ) {
            openedHistories.set(item.tradeIndex, true);
          }

          if (
            item.action === TradeActionType.TradeClosedMarket ||
            item.action === TradeActionType.TradeClosedLIQ ||
            item.action === TradeActionType.TradeClosedSL ||
            item.action === TradeActionType.TradeClosedTP
          ) {
            openedHistories.set(item.tradeIndex, false);
          }

          const prevPnl = pnlMaps.get(item.tradeIndex) || 0;

          pnlMaps.set(item.tradeIndex, prevPnl + +item.pnl);

          const prevSize = sizeMaps.get(item.tradeIndex) || 0;

          sizeMaps.set(
            item.tradeIndex,
            Math.max(prevSize, +item.size * +item.leverage),
          );
        });

        const openedHistoriesArr = Array.from(openedHistories.entries())
          .filter((item) => item[1])
          .map((item) => item[0]);

        // if trader holds too many positions, skip
        if (openedHistoriesArr.length > 17) {
          continue;
        }

        const chunkHistories = expert.histories
          .filter((item) => {
            const pair = pairMap.get(
              `${expert.contractId}-${item.pair}`.toLowerCase(),
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

        const pnlRatios = chunkHistories
          .filter(
            (history) =>
              history.action === TradeActionType.TradeClosedMarket ||
              history.action === TradeActionType.TradeClosedLIQ ||
              history.action === TradeActionType.TradeClosedSL ||
              history.action === TradeActionType.TradeClosedTP,
          )
          .map((item) => {
            const pnl = pnlMaps.get(item.tradeIndex) || 0;
            const size = sizeMaps.get(item.tradeIndex) || 0;
            return size > 0 ? (pnl / size) * 100 : null;
          })
          .filter((item) => item !== null);

        if (pnlRatios.length > 0) {
          const avgPnlP =
            pnlRatios.reduce((acc, item) => acc + item, 0) / pnlRatios.length;

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
              maxLeverage: 200000,
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
      const allExpertPnlSnapshots = await this.filterExperts(dateStr);
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
      const allExpertPnlSnapshots = await this.filterExperts(dateStr);
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

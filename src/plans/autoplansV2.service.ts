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

const bestFilter = {
  minR2: 0.9,
  window: 6,
  minScore: 10,
  n: 2,
  m: 1,
};

export type ServiceStatus = 'process' | 'ready';

@Injectable()
export class AutoPlansV2Service {
  status: ServiceStatus = 'ready';

  constructor(
    private prismaService: PrismaService,
    private planService: PlansService,
    private botService: BotsService,
    private logger: LogsService,
  ) {
    this.status = 'ready';
  }

  private getExpertPnlSnapshot(
    snapshot: PnlSnapshot,
    histories: TradeHistory[],
  ): (PnlSnapshot & { score: number }) | null {
    const rangeHistories = histories;

    const openHistoriesMap: Record<number, TradeHistory[]> = {};

    rangeHistories.forEach((history) => {
      if (
        history.action === TradeActionType.TradeOpenedMarket ||
        history.action === TradeActionType.TradeOpenedLimit
      ) {
        const arr = openHistoriesMap[history.tradeIndex];

        if (arr) {
          arr.push(history);
        } else {
          openHistoriesMap[history.tradeIndex] = [history];
        }
      }
    });

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

    for (let step = 0; step < bestFilter.window; step++) {
      let round = 0;
      let stepScore = 0;

      for (let i = 0; i < closeHistories.length; i += bestFilter.window) {
        round++;

        const chunk = closeHistories.slice(
          Math.max(closeHistories.length - i - step - bestFilter.window, 0),
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
          if (score.r2 > bestFilter.minR2) {
            stepScore += (regression.slope * score.r2) / round / bestFilter.n;
          } else {
            stepScore +=
              (regression.slope * (score.r2 - 1) * bestFilter.m) /
              round /
              bestFilter.n;
          }
        } else {
          stepScore +=
            (regression.slope * (2 - score.r2) * bestFilter.m) /
            round /
            bestFilter.n;
        }
      }
      traderScore += stepScore;
    }

    if (traderScore <= bestFilter.minScore) {
      return null;
    }

    return {
      ...snapshot,
      score: (traderScore * closeHistories.length) / bestFilter.window,
    };
  }

  private async filterExperts(
    dateStr: string,
  ): Promise<(PnlSnapshot & { score: number })[]> {
    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        where: {
          dateStr: dateStr,
          accUSDPnl: {
            gt: 0,
          },
          kind: PnlSnapshotKind.MONTH,
          contractId: {
            not: 4,
          },
        },
        orderBy: {
          accUSDPnl: 'desc',
        },
      });

    const pnlSnapshotsMap = new Map<string, PnlSnapshot[]>();

    pnlRecords.forEach((record) => {
      if (record.contractId === 0) {
        return;
      }

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
              ...(item.contractId !== 0 ? { contractId: item.contractId } : {}),
            })),
        ],
      },
      orderBy: {
        date: 'asc',
      },
    });

    const historyRecordsMap = new Map<string, TradeHistory[]>();
    const expertPnlSnapshots: (PnlSnapshot & { score: number })[] = [];

    historyRecords.forEach((record) => {
      const key = JSON.stringify({
        address: record.address,
        contractId: record.contractId,
      });

      const arr = historyRecordsMap.get(key);

      if (arr) {
        arr.push(record);
      } else {
        historyRecordsMap.set(key, [record]);
      }
    });

    pnlSnapshotsMapKeys.forEach((key) => {
      const subPnlRecords = pnlSnapshotsMap.get(key) || [];
      const allHistories = historyRecordsMap.get(key) || [];

      subPnlRecords.forEach((record) => {
        const detail = this.getExpertPnlSnapshot(record, allHistories);

        if (detail) {
          expertPnlSnapshots.push(detail);
        }
      });
    });

    return expertPnlSnapshots;
  }

  private async createPlan(
    user: User,
    realExpertPnlSnapshots: (PnlSnapshot & { score: number })[],
  ): Promise<boolean> {
    try {
      if (user.followerContractId === 0) {
        throw new Error('Invalid User');
      }

      const planInput: CreatePlanInput = {
        title: 'Auto Plan V2',
        description: 'This is an auto plan',
        scheduledStart: new Date(),
        scheduledEnd: dayjs(new Date())
          .add(3, 'hours')
          .add(30, 'minutes')
          .toDate(),
      };

      const plan = await this.planService.create(
        user.address.toLowerCase(),
        planInput,
      );

      if (!plan) {
        throw new Error('Cannot create a plan');
      }

      const totalScores = realExpertPnlSnapshots.reduce(
        (acc, snapshot) => acc + snapshot.score,
        0,
      );

      if (totalScores === 0) {
        throw new Error('Invalid total scores');
      }

      const botInputs: CreateBotAndStrategyInput[] = realExpertPnlSnapshots.map(
        (snapshot) => ({
          planId: plan.id,
          followerContractId: user.followerContractId,
          leaderAddress: snapshot.address,
          leaderCollateralBaseline: 0,
          leaderContractId: snapshot.contractId,
          strategy: {
            strategyKey: 'ratioCopy',
            ratio:
              user.ratio * 0.1 +
              (user.ratio * Math.floor((snapshot.score * 100) / totalScores)) /
                100, // dynamic ratio for each expert
            lifeTime: 365 * 24 * 60,
            maxCollateral: Math.floor(user.budget * 0.1), // 10% of the whole budget
            minCollateral: 5,
            collateralBaseline: 0,
            maxLeverage: 200000,
            minLeverage: 1100,
            params: '{}',
          },
        }),
      );

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

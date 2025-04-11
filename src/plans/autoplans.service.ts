import { Injectable } from '@nestjs/common';
import {
  PnlSnapshotKind,
  PnlSnapshot,
  TradeHistory,
  TradeActionType,
  UserPermission,
} from '@prisma/client';
import * as dayjs from 'dayjs';
import { SimpleLinearRegression } from 'ml-regression-simple-linear';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/loggers/logs.service';

import { ExpertFilterParams, bestCaseFilters } from './expert-filters/v0';
import { getReadableError, getStartOfDay } from 'src/utils';
import { CreatePlanInput } from './dto/plan.input';
import { CreateBotAndStrategyInput } from 'src/bots/dto/bot.input';
import { PlansService } from './plans.service';
import { BotsService } from 'src/bots/bots.service';

export type ServiceStatus = 'process' | 'ready';

const MIN_SLOPE = 150;

@Injectable()
export class AutoPlansService {
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
    params: ExpertFilterParams[],
  ): PnlSnapshot | null {
    const timestampGap = 30 * 24 * 60 * 60 * 1000;

    const endDate = new Date(
      getStartOfDay(new Date(snapshot.dateStr)).getTime() + 24 * 3600 * 1000,
    );
    const startDate = new Date(endDate.getTime() - timestampGap);

    const rangeHistories = histories.filter((history) => {
      const historyDate = new Date(history.date);

      return (
        historyDate.getTime() >= startDate.getTime() &&
        historyDate.getTime() <= endDate.getTime()
      );
    });

    const openHistories = rangeHistories.filter((history) => {
      return (
        history.action === TradeActionType.TradeOpenedMarket ||
        history.action === TradeActionType.TradeOpenedLimit
      );
    });

    if (openHistories.length === 0) {
      return null;
    }

    const filteredCloseHistories = rangeHistories.filter((history) => {
      return (
        history.action === TradeActionType.TradeClosedMarket ||
        history.action === TradeActionType.TradeClosedLIQ ||
        history.action === TradeActionType.TradeClosedSL ||
        history.action === TradeActionType.TradeClosedTP
      );
    });

    let pnlSum = 0;
    let sumIn = openHistories.reduce((acc, history) => {
      return acc + +history.size * +history.collateralPriceUsd;
    }, 0);
    let countIn = openHistories.length;

    const avgSize = countIn > 0 ? sumIn / countIn : 0;

    const pnlArrs: number[] = [];
    const xs: number[] = [];

    for (let i = 0; i < filteredCloseHistories.length; i++) {
      const history = filteredCloseHistories[i];

      pnlSum += +history.pnl * +history.collateralPriceUsd;

      pnlArrs.push(pnlSum);
      xs.push(i);
    }

    const regression = new SimpleLinearRegression(xs, pnlArrs);
    const score = regression.score(xs, pnlArrs);

    const filterParam = params.find(
      (item) =>
        item.minCount <= filteredCloseHistories.length &&
        item.maxCount >= filteredCloseHistories.length &&
        item.minSize <= avgSize &&
        item.maxSize >= avgSize,
    );

    if (!filterParam) {
      return null;
    }

    if (Number.isNaN(score.r2)) {
      return null;
    }

    if (score.r2 < filterParam.minR2 || regression.slope < MIN_SLOPE) {
      return null;
    }

    return snapshot;
  }

  private async filterExperts(dateStr: string): Promise<PnlSnapshot[]> {
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
    const expertPnlSnapshots: PnlSnapshot[] = [];

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
        const detail = this.getExpertPnlSnapshot(
          record,
          allHistories,
          bestCaseFilters,
        );

        if (detail) {
          expertPnlSnapshots.push(detail);
        }
      });
    });

    return expertPnlSnapshots;
  }

  async createAutoPlans() {
    this.status = 'process';

    const dateStr = dayjs().format('YYYY-MM-DD');

    try {
      const expertPnlSnapshots = await this.filterExperts(dateStr);

      this.logger.log({
        severity: 'Info',
        summary: 'AutoPlansService>createAutoPlans',
        details: `[AutoPlansService] ${dateStr} expertPnlSnapshots: ${expertPnlSnapshots.length}`,
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
        if (user.followerContractId === 0) {
          continue;
        }

        const planInput: CreatePlanInput = {
          title: 'Auto Plan',
          description: 'This is an auto plan',
          scheduledStart: new Date(),
          scheduledEnd: dayjs(new Date()).add(1, 'day').toDate(),
        };

        const plan = await this.planService.create(
          user.address.toLowerCase(),
          planInput,
        );

        if (!plan) {
          continue;
        }

        const botInputs: CreateBotAndStrategyInput[] = expertPnlSnapshots.map(
          (snapshot) => ({
            planId: plan.id,
            followerContractId: user.followerContractId,
            leaderAddress: snapshot.address,
            leaderCollateralBaseline: 0,
            leaderContractId: snapshot.contractId,
            strategy: {
              strategyKey: 'ratioCopy',
              ratio: user.ratio,
              lifeTime: 365 * 24 * 60,
              maxCollateral: Math.floor(user.budget),
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
}

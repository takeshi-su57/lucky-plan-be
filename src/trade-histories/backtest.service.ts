import { Injectable } from '@nestjs/common';
import { PnlSnapshotKind, TradeActionType, TradeHistory } from '@prisma/client';
import * as dayjs from 'dayjs';
import { SimpleLinearRegression } from 'ml-regression-simple-linear';

import { PrismaService } from 'src/global/prisma.service';
import { getStartOfDay } from 'src/utils';
import {
  PnlSnapshotDetails,
  PnlSnapshotDevDetails,
  AccPnl,
  PnlSnapshot,
  BotCount,
} from './entities/trade-history.entity';
import { ExportFilter } from './dto/trade-history.input';

const pnlSnapshotKinds = [
  PnlSnapshotKind.DAY,
  PnlSnapshotKind.TWO_DAY,
  PnlSnapshotKind.THREE_DAY,
  PnlSnapshotKind.WEEK,
  PnlSnapshotKind.TWO_WEEK,
  PnlSnapshotKind.MONTH,
  PnlSnapshotKind.THREE_MONTH,
  PnlSnapshotKind.HALF_YEAR,
  PnlSnapshotKind.YEAR,
  PnlSnapshotKind.ALL_TIME,
];

const timestampGapByPnlSnapshotKind = {
  [PnlSnapshotKind.DAY]: 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.TWO_DAY]: 2 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.THREE_DAY]: 3 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.WEEK]: 7 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.TWO_WEEK]: 2 * 7 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.MONTH]: 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.THREE_MONTH]: 3 * 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.HALF_YEAR]: 6 * 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.YEAR]: 365 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.ALL_TIME]: 10 * 365 * 24 * 60 * 60 * 1000,
};

type ExportFilterParams = {
  recentTradedDays: number;
  closePositionCountsByPnlSnapshotKind: Record<PnlSnapshotKind, number>;
  minR2: number;
  maxR2: number;
  minSlope: number;
  maxSlope: number;
};

@Injectable()
export class BacktestService {
  status: 'processing' | 'ready' = 'ready';

  constructor(private prismaService: PrismaService) {}

  private getPnlSnapshotDevDetails(
    snapshot: PnlSnapshot,
    histories: TradeHistory[],
    params: ExportFilterParams,
  ): PnlSnapshotDevDetails | null {
    const currentKindIndex = pnlSnapshotKinds.findIndex(
      (kind) => kind === snapshot.kind,
    );

    const previousTimestampGap =
      currentKindIndex > 0
        ? timestampGapByPnlSnapshotKind[pnlSnapshotKinds[currentKindIndex - 1]]
        : 0;
    const timestampGap = timestampGapByPnlSnapshotKind[snapshot.kind];

    const endDate = new Date(
      getStartOfDay(new Date(snapshot.dateStr)).getTime() + 24 * 3600 * 1000,
    );
    const midDate = new Date(endDate.getTime() - previousTimestampGap);
    const startDate = new Date(endDate.getTime() - timestampGap);

    let recentTraded = false;
    let tradedInMid = false;

    const rangeHistories = histories.filter((history) => {
      const historyDate = new Date(history.date);

      if (
        historyDate.getTime() >=
          endDate.getTime() - params.recentTradedDays * 24 * 3600 * 1000 &&
        historyDate.getTime() <= endDate.getTime()
      ) {
        recentTraded = true;
      }

      if (
        historyDate.getTime() >= startDate.getTime() &&
        historyDate.getTime() <= midDate.getTime()
      ) {
        tradedInMid = true;
      }

      return (
        historyDate.getTime() >= startDate.getTime() &&
        historyDate.getTime() <= endDate.getTime()
      );
    });

    if (!recentTraded || !tradedInMid) {
      return null;
    }

    const filteredOpenHistories = rangeHistories.filter((history) => {
      return (
        history.action === TradeActionType.TradeOpenedMarket ||
        history.action === TradeActionType.TradeOpenedLimit ||
        history.action === TradeActionType.TradeLeverageUpdate ||
        history.action === TradeActionType.TradePosSizeIncrease
      );
    });

    const filteredCloseHistories = rangeHistories.filter((history) => {
      return (
        history.action === TradeActionType.TradeClosedMarket ||
        history.action === TradeActionType.TradeClosedLIQ ||
        history.action === TradeActionType.TradeClosedSL ||
        history.action === TradeActionType.TradeClosedTP
      );
    });

    if (
      filteredCloseHistories.length <
      params.closePositionCountsByPnlSnapshotKind[snapshot.kind]
    ) {
      return null;
    }

    let pnlSum = 0;
    let sumIn = 0;
    let countIn = 0;

    for (let i = 0; i < filteredOpenHistories.length; i++) {
      const history = filteredOpenHistories[i];

      if (
        history.action === TradeActionType.TradeOpenedMarket ||
        history.action === TradeActionType.TradeOpenedLimit
      ) {
        sumIn += +history.size;
        countIn++;
      }
    }

    const pnlArrs: number[] = [];
    const xs: number[] = [];

    for (let i = 0; i < filteredCloseHistories.length; i++) {
      const history = filteredCloseHistories[i];

      pnlSum += +history.pnl;

      pnlArrs.push(pnlSum);
      xs.push(i);
    }

    const regression = new SimpleLinearRegression(xs, pnlArrs);
    const score = regression.score(xs, pnlArrs);

    if (score.r2 < params.minR2 || score.r2 > params.maxR2) {
      return null;
    }

    if (
      regression.slope < params.minSlope ||
      regression.slope > params.maxSlope
    ) {
      return null;
    }

    return {
      ...snapshot,
      histories,
      regression: {
        slope: regression.slope,
        intercept: regression.intercept,
        r: Number.isNaN(score.r) ? 1 : score.r,
        r2: Number.isNaN(score.r2) ? 1 : score.r2,
        chi2: score.chi2,
        rmsd: score.rmsd,
      },
      statistic: {
        averageIn: countIn > 0 ? sumIn / countIn : 0,
        countIn,
      },
    };
  }

  private getSortedPartialHistories(
    histories: TradeHistory[],
    startDate: Date,
    endDate: Date,
  ): TradeHistory[] {
    const sortedHistories = histories.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    const valideTradeIndexMap: Record<number, boolean> = {};

    sortedHistories.forEach((history) => {
      if (startDate && startDate > new Date(history.date)) {
        return;
      }

      if (endDate && endDate < new Date(history.date)) {
        return;
      }

      if (
        history.action === TradeActionType.TradeOpenedMarket ||
        history.action === TradeActionType.TradeOpenedLimit
      ) {
        valideTradeIndexMap[history.tradeIndex] = true;
      }
    });

    const historiesByTradeIndex: Record<number, TradeHistory[]> = {};

    sortedHistories.forEach((history) => {
      if (!valideTradeIndexMap[history.tradeIndex]) {
        return;
      }

      if (!historiesByTradeIndex[history.tradeIndex]) {
        historiesByTradeIndex[history.tradeIndex] = [];
      }

      historiesByTradeIndex[history.tradeIndex].push(history);
    });

    return Object.values(historiesByTradeIndex)
      .flat()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  private async getDayDevPnlSnapshots(
    dateStr: string,
    params: ExportFilterParams,
  ): Promise<PnlSnapshotDetails[]> {
    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        where: {
          dateStr,
          accUSDPnl: {
            gt: 0,
          },
          kind: {
            notIn: [PnlSnapshotKind.ALL_TIME, PnlSnapshotKind.YEAR],
          },
        },
        orderBy: {
          accUSDPnl: 'desc',
        },
      });

    console.log('pnlRecords ==>', pnlRecords.length);

    const CHUNK = 100;

    const nodes: PnlSnapshotDevDetails[] = [];

    for (let i = 0; i < pnlRecords.length; i += CHUNK) {
      console.log(
        `Processing chunk ${i / CHUNK + 1} of ${Math.ceil(pnlRecords.length / CHUNK)}`,
      );

      const chunk = pnlRecords.slice(i, i + CHUNK);

      const historyRecords = await this.prismaService.tradeHistory.findMany({
        where: {
          OR: [
            ...chunk.map((item) => ({
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

      historyRecords.forEach((record) => {
        const arr = historyRecordsMap.get(
          `${record.address}-${record.contractId}`,
        );

        if (arr) {
          arr.push(record);
        } else {
          historyRecordsMap.set(`${record.address}-${record.contractId}`, [
            record,
          ]);
        }
      });

      pnlRecords.forEach((record) => {
        const allHistories =
          historyRecordsMap.get(`${record.address}-${record.contractId}`) || [];

        const detail = this.getPnlSnapshotDevDetails(
          record,
          allHistories,
          params,
        );

        if (detail) {
          nodes.push(detail);
        }
      });

      console.log(
        `Ended chunk ${i / CHUNK + 1} of ${Math.ceil(pnlRecords.length / CHUNK)}`,
      );
    }

    console.log('total leaders ==>', nodes.length);

    return nodes;
  }

  private async getRangeHistories(
    dateStr: string,
    days: number,
    params: ExportFilterParams,
  ): Promise<{
    accPnls: AccPnl[];
    botCounts: BotCount[];
    histories: TradeHistory[];
    maxInvested: number;
  }> {
    const dateStrs: string[] = [];

    for (let i = 0; i < days; i++) {
      dateStrs.push(dayjs(dateStr).add(i, 'days').format('YYYY-MM-DD'));
    }

    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        where: {
          dateStr: {
            in: dateStrs,
          },
          accUSDPnl: {
            gt: 0,
          },
          kind: {
            notIn: [PnlSnapshotKind.ALL_TIME, PnlSnapshotKind.YEAR],
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

    console.log('pnlRecords ==>', pnlRecords.length);
    console.log('pnlSnapshotsMapKeys ==>', pnlSnapshotsMapKeys.length);

    const CHUNK = 50;
    const totalResultHistories: TradeHistory[] = [];

    const botCountData: Record<string, number> = {};

    for (let i = 0; i < pnlSnapshotsMapKeys.length; i += CHUNK) {
      console.log(
        `Processing chunk ${i / CHUNK + 1} of ${Math.ceil(pnlSnapshotsMapKeys.length / CHUNK)}`,
      );

      const chunk = pnlSnapshotsMapKeys.slice(i, i + CHUNK);

      const historyRecords = await this.prismaService.tradeHistory.findMany({
        where: {
          OR: [
            ...chunk
              .map(
                (item) =>
                  JSON.parse(item) as { address: string; contractId: number },
              )
              .map((item) => ({
                address: item.address,
                ...(item.contractId !== 0
                  ? { contractId: item.contractId }
                  : {}),
              })),
          ],
        },
        orderBy: {
          date: 'asc',
        },
      });

      const historyRecordsMap = new Map<string, TradeHistory[]>();

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

      chunk.forEach((key) => {
        const subPnlRecords = pnlSnapshotsMap.get(key) || [];
        const allHistories = historyRecordsMap.get(key) || [];

        const nodes: PnlSnapshotDevDetails[] = [];

        subPnlRecords.forEach((record) => {
          const detail = this.getPnlSnapshotDevDetails(
            record,
            allHistories,
            params,
          );

          if (detail) {
            nodes.push(detail);
          }
        });

        if (nodes.length > 0) {
          console.log('chunk', key);
          console.log('subPnlRecords', subPnlRecords.length);
          console.log('allHistories', allHistories.length);

          console.log('nodes ==>', nodes.length);
        }

        nodes.forEach((node) => {
          const dateStr = node.dateStr;

          botCountData[dateStr] = (botCountData[dateStr] || 0) + 1;

          const startDate = new Date(
            new Date(dateStr).getTime() + 24 * 3600 * 1000,
          );
          const endDate = new Date(startDate.getTime() + 48 * 3600 * 1000);

          const histories = this.getSortedPartialHistories(
            node.histories,
            startDate,
            endDate,
          );

          totalResultHistories.push(...histories);
        });
      });

      console.log(
        `Ended chunk ${i / CHUNK + 1} of ${Math.ceil(pnlSnapshotsMapKeys.length / CHUNK)}`,
      );
    }

    console.log('total histories ==>', totalResultHistories.length);

    const accPnlData: Record<string, number> = {};
    const accInOutData: Record<string, number> = {};
    const taskCountData: Record<string, number> = {};
    const positionCountData: Record<string, Record<string, boolean>> = {};

    const traderCountData: Record<string, Record<string, boolean>> = {};

    let accInOut = 0;
    let maxInvested = 0;

    totalResultHistories
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach((history) => {
        const date = dayjs(history.date).format('YYYY-MM-DD HH:[00]:[00]');
        const usdPnl = +history.pnl * +history.collateralPriceUsd;

        accPnlData[date] = (accPnlData[date] ?? 0) + usdPnl;
        taskCountData[date] = (taskCountData[date] ?? 0) + 1;

        const positionCountMap = positionCountData[date] ?? {};
        positionCountMap[history.tradeIndex] = true;
        positionCountData[date] = positionCountMap;

        const traderCountMap = traderCountData[date] ?? {};
        traderCountMap[history.address.toLowerCase()] = true;
        traderCountData[date] = traderCountMap;

        switch (history.action) {
          case TradeActionType.TradeOpenedMarket: {
            const inOut = +history.size * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + -inOut;
            accInOut = accInOut + -inOut;

            break;
          }
          case TradeActionType.TradeOpenedLimit: {
            const inOut = +history.size * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + -inOut;

            accInOut = accInOut + -inOut;

            break;
          }
          case TradeActionType.TradeClosedMarket: {
            const inOut =
              (+history.size + +history.pnl) * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

            accInOut = accInOut + inOut;

            break;
          }
          case TradeActionType.TradeClosedLIQ: {
            const inOut =
              (+history.size + +history.pnl) * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

            accInOut = accInOut + inOut;

            break;
          }
          case TradeActionType.TradeClosedSL: {
            const inOut =
              (+history.size + +history.pnl) * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

            accInOut = accInOut + inOut;

            break;
          }
          case TradeActionType.TradeClosedTP: {
            const inOut =
              (+history.size + +history.pnl) * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

            accInOut = accInOut + inOut;

            break;
          }
          case TradeActionType.TradeLeverageUpdate: {
            const delta =
              (-(history.collateralDelta || 0) + +history.pnl) *
              +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + delta;

            accInOut = accInOut + delta;

            break;
          }
          case TradeActionType.TradePosSizeIncrease: {
            const delta =
              (-(history.collateralDelta || 0) + +history.pnl) *
              +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + delta;

            accInOut = accInOut + delta;

            break;
          }
          case TradeActionType.TradePosSizeDecrease: {
            const delta =
              (-(history.collateralDelta || 0) + +history.pnl) *
              +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + delta;

            accInOut = accInOut + delta;

            break;
          }
        }

        maxInvested = Math.min(maxInvested, accInOut);
      });

    const accPnls: AccPnl[] = Object.entries(accPnlData)
      .map(([date, pnl]) => ({
        date: dayjs(date).toDate(),
        pnl,
        inOut: accInOutData[date] ?? 0,
        taskCount: taskCountData[date] ?? 0,
        positionCount: Object.keys(positionCountData[date] ?? {}).length,
        traderCount: Object.keys(traderCountData[date] ?? {}).length,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const botCounts: BotCount[] = Object.entries(botCountData)
      .map(([date, count]) => ({
        date: dayjs(date).toDate(),
        botCount: count,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    console.log('accPnls ==>', accPnls.length);
    console.log('botCounts ==>', botCounts.length);

    return { accPnls, botCounts, histories: totalResultHistories, maxInvested };
  }

  // initial params for test case 1
  private getTestParam(filterParams: ExportFilter): ExportFilterParams {
    return {
      recentTradedDays: filterParams.recentTradedDays,
      closePositionCountsByPnlSnapshotKind: JSON.parse(
        filterParams.closePositionCountsByPnlSnapshotKind,
      ) as Record<PnlSnapshotKind, number>,
      minR2: filterParams.minR2,
      maxR2: filterParams.maxR2,
      minSlope: filterParams.minSlope,
      maxSlope: filterParams.maxSlope,
    };
  }

  async getDevPnlSnapshots(dateStr: string, filterParams: ExportFilter) {
    return this.getDayDevPnlSnapshots(dateStr, this.getTestParam(filterParams));
  }

  async getMonthlyDevPnlSnapshots(
    dateStr: string,
    filterParams: ExportFilter,
  ): Promise<TradeHistory[]> {
    const params = this.getTestParam(filterParams);
    const { histories } = await this.getRangeHistories(dateStr, 31, params);

    return histories;
  }

  async getWholeResultHistories(filterParams: ExportFilter) {
    const { histories } = await this.getRangeHistories(
      '2024-11-01',
      150,
      this.getTestParam(filterParams),
    );

    return histories;
  }

  async getWholeCompressedHistories(filterParams: ExportFilter) {
    console.time('getWholeCompressedHistories==============>');

    const { accPnls, botCounts, maxInvested } = await this.getRangeHistories(
      '2024-11-01',
      150,
      this.getTestParam(filterParams),
    );

    console.timeEnd('getWholeCompressedHistories==============>');

    return {
      accPnls,
      botCounts,
      maxInvested,
    };
  }
}

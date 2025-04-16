import { Injectable } from '@nestjs/common';
import {
  PnlSnapshotKind,
  TestingReportV2,
  TradeActionType,
  TradeHistory,
} from '@prisma/client';
import * as dayjs from 'dayjs';
import { SimpleLinearRegression } from 'ml-regression-simple-linear';

import { PrismaService } from 'src/global/prisma.service';
import { getStartOfDay } from 'src/utils';
import {
  PnlSnapshotDevDetails,
  AccPnl,
  PnlSnapshot,
  BotCount,
  TestingReportV2Edge,
} from './entities/trade-history.entity';
import { ExportFilterV2 } from './dto/trade-history.input';

const pnlSnapshotKinds = [
  PnlSnapshotKind.DAY,
  PnlSnapshotKind.TWO_DAY,
  PnlSnapshotKind.THREE_DAY,
  PnlSnapshotKind.WEEK,
  PnlSnapshotKind.TWO_WEEK,
  PnlSnapshotKind.MONTH,
  PnlSnapshotKind.THREE_MONTH,
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

const recentTradedDays = 21;
const closeHistoriesCount = 7;

type ExportFilterV2Params = {
  r2MinsByPnlSnapshotKind: Record<PnlSnapshotKind, number>;
  minSlope: number;
  maxSlope: number;
};

@Injectable()
export class BacktestV2Service {
  status: 'processing' | 'ready' = 'ready';

  constructor(private prismaService: PrismaService) {
    // this.autoTesting();
  }

  private getPnlSnapshotDevDetails(
    snapshot: PnlSnapshot,
    histories: TradeHistory[],
    params: ExportFilterV2Params[],
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
          endDate.getTime() - recentTradedDays * 24 * 3600 * 1000 &&
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

    if (filteredCloseHistories.length < closeHistoriesCount) {
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

      pnlSum += +history.pnl * +history.collateralPriceUsd;

      pnlArrs.push(pnlSum);
      xs.push(i);
    }

    const regression = new SimpleLinearRegression(xs, pnlArrs);
    const score = regression.score(xs, pnlArrs);

    const filterParam = params.find(
      (item) =>
        item.minSlope <= regression.slope && item.maxSlope >= regression.slope,
    );

    if (!filterParam) {
      return null;
    }

    if (Number.isNaN(score.r2)) {
      return null;
    }

    if (score.r2 < filterParam.r2MinsByPnlSnapshotKind[snapshot.kind]) {
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

  private async getRangeHistories(
    dateStr: string,
    days: number,
    params: ExportFilterV2Params[],
  ): Promise<{
    accPnls: AccPnl[];
    botCounts: BotCount[];
    histories: TradeHistory[];
    maxInvested: number;
    uniqueTraders: number;
    maxLoss: number;
    avgLoss: number;
    maxProfit: number;
    avgProfit: number;
    bottomPnl: number;
    peakPnl: number;
    lossCount: number;
    profitCount: number;
    totalPnls: number;
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

    const CHUNK = 50;
    const totalResultHistories: TradeHistory[] = [];
    const countStatistics: Record<string, Record<number, number>> = {};
    const sizeStatistics: Record<string, Record<number, number>> = {};

    const botCountData: Record<string, number> = {};

    for (let i = 0; i < pnlSnapshotsMapKeys.length; i += CHUNK) {
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

        const openHistories = allHistories.filter(
          (history) =>
            history.action === TradeActionType.TradeOpenedMarket ||
            history.action === TradeActionType.TradeOpenedLimit,
        );

        const openAverageIn =
          openHistories.reduce((acc, history) => {
            return acc + +history.size;
          }, 0) / openHistories.length;

        const nodes: PnlSnapshotDevDetails[] = [];

        subPnlRecords.forEach((record) => {
          const detail = this.getPnlSnapshotDevDetails(
            record,
            allHistories,
            params,
          );

          const countObj = countStatistics[record.kind];

          if (countObj) {
            const count = countObj[allHistories.length] || 0;
            countObj[allHistories.length] = count + 1;
          } else {
            countStatistics[record.kind] = {
              [allHistories.length]: 1,
            };
          }

          const sizeObj = sizeStatistics[record.kind];

          if (sizeObj) {
            const size = sizeObj[Math.floor(openAverageIn)] || 0;
            sizeObj[Math.floor(openAverageIn)] = size + 1;
          } else {
            sizeStatistics[record.kind] = {
              [Math.floor(openAverageIn)]: 1,
            };
          }

          if (detail) {
            nodes.push(detail);
          }
        });

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
    }

    const accInData: Record<string, number> = {};
    const accOutData: Record<string, number> = {};
    const accPnlData: Record<string, number> = {};
    const accInOutData: Record<string, number> = {};
    const taskCountData: Record<string, number> = {};
    const positionCountData: Record<string, Record<string, boolean>> = {};

    const traderCountData: Record<string, Record<string, boolean>> = {};
    const uniqueTraders: Record<string, boolean> = {};

    let accInOut = 0;
    let maxInvested = 0;

    let accPnlLoss = 0;
    let lossCount = 0;
    let accPnlProfit = 0;
    let profitCount = 0;
    let bottomPnl = 0;
    let peakPnl = 0;
    let accPnl = 0;
    let maxLoss = 0;
    let maxProfit = 0;

    totalResultHistories
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach((history) => {
        const date = dayjs(history.date).format('YYYY-MM-DD HH:[00]:[00]');
        const usdPnl = +history.pnl * +history.collateralPriceUsd;

        accPnl += usdPnl;

        peakPnl = Math.max(peakPnl, accPnl);
        bottomPnl = Math.min(bottomPnl, accPnl);

        if (usdPnl < 0) {
          accPnlLoss += usdPnl;
          maxLoss = Math.min(maxLoss, usdPnl);
          lossCount++;
        } else if (usdPnl > 0) {
          accPnlProfit += usdPnl;
          maxProfit = Math.max(maxProfit, usdPnl);
          profitCount++;
        }

        accPnlData[date] = (accPnlData[date] ?? 0) + usdPnl;
        taskCountData[date] = (taskCountData[date] ?? 0) + 1;
        uniqueTraders[history.address.toLowerCase()] = true;

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

            accInData[date] = (accInData[date] ?? 0) + inOut;

            break;
          }
          case TradeActionType.TradeOpenedLimit: {
            const inOut = +history.size * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + -inOut;

            accInOut = accInOut + -inOut;

            accInData[date] = (accInData[date] ?? 0) + inOut;

            break;
          }
          case TradeActionType.TradeClosedMarket: {
            const inOut =
              (+history.size + +history.pnl) * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

            accInOut = accInOut + inOut;

            accOutData[date] = (accOutData[date] ?? 0) + inOut;

            break;
          }
          case TradeActionType.TradeClosedLIQ: {
            const inOut =
              (+history.size + +history.pnl) * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

            accInOut = accInOut + inOut;

            accOutData[date] = (accOutData[date] ?? 0) + inOut;

            break;
          }
          case TradeActionType.TradeClosedSL: {
            const inOut =
              (+history.size + +history.pnl) * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

            accInOut = accInOut + inOut;

            accOutData[date] = (accOutData[date] ?? 0) + inOut;

            break;
          }
          case TradeActionType.TradeClosedTP: {
            const inOut =
              (+history.size + +history.pnl) * +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

            accInOut = accInOut + inOut;

            accOutData[date] = (accOutData[date] ?? 0) + inOut;

            break;
          }
          case TradeActionType.TradeLeverageUpdate: {
            const delta =
              (-(history.collateralDelta || 0) + +history.pnl) *
              +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + delta;

            accInOut = accInOut + delta;

            if (delta > 0) {
              accOutData[date] = (accOutData[date] ?? 0) + delta;
            } else {
              accInData[date] = (accInData[date] ?? 0) + -delta;
            }

            break;
          }
          case TradeActionType.TradePosSizeIncrease: {
            const delta =
              (-(history.collateralDelta || 0) + +history.pnl) *
              +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + delta;

            accInOut = accInOut + delta;

            if (delta > 0) {
              accOutData[date] = (accOutData[date] ?? 0) + delta;
            } else {
              accInData[date] = (accInData[date] ?? 0) + -delta;
            }

            break;
          }
          case TradeActionType.TradePosSizeDecrease: {
            const delta =
              (-(history.collateralDelta || 0) + +history.pnl) *
              +history.collateralPriceUsd;

            accInOutData[date] = (accInOutData[date] ?? 0) + delta;

            accInOut = accInOut + delta;

            if (delta > 0) {
              accOutData[date] = (accOutData[date] ?? 0) + delta;
            } else {
              accInData[date] = (accInData[date] ?? 0) + -delta;
            }

            break;
          }
        }

        maxInvested = Math.min(maxInvested, accInOut);
      });

    const accPnls: AccPnl[] = Object.entries(accPnlData)
      .map(([date, pnl]) => ({
        date: dayjs(date).toDate(),
        pnl,
        in: accInData[date] ?? 0,
        out: accOutData[date] ?? 0,
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

    // const fs = require('fs');
    // fs.writeFileSync(
    //   'statistics.json',
    //   JSON.stringify(
    //     {
    //       countStatistics,
    //       sizeStatistics,
    //     },
    //     null,
    //     2,
    //   ),
    // );

    return {
      accPnls,
      botCounts,
      histories: totalResultHistories,
      maxInvested,
      uniqueTraders: Object.keys(uniqueTraders).length,
      maxLoss,
      maxProfit,
      bottomPnl,
      peakPnl,
      lossCount,
      profitCount,
      avgLoss: lossCount > 0 ? accPnlLoss / lossCount : 0,
      avgProfit: profitCount > 0 ? accPnlProfit / profitCount : 0,
      totalPnls: accPnl,
    };
  }

  // initial params for test case 1
  private getTestParam(filterParams: ExportFilterV2[]): ExportFilterV2Params[] {
    return filterParams.map((item) => ({
      r2MinsByPnlSnapshotKind: JSON.parse(
        item.r2MinsByPnlSnapshotKind,
      ) as Record<PnlSnapshotKind, number>,
      minSlope: item.minSlope,
      maxSlope: item.maxSlope,
    }));
  }

  async getWholeCompressedHistoriesV2(filterParams: ExportFilterV2[]) {
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

  private getPnlData(
    items: { pnl: number; date: Date }[],
    scales: string[],
    dateFormat: string,
  ): {
    data: { value: number; label: string }[];
    accData: { value: number; label: string }[];
  } {
    const dailyPnlData: Record<string, number> = {};

    items.forEach((history) => {
      const date = dayjs(history.date).format(dateFormat);
      dailyPnlData[date] = (dailyPnlData[date] ?? 0) + +history.pnl;
    });

    const data: { value: number; label: string }[] = [];
    const accData: { value: number; label: string }[] = [];
    let accPnl = 0;

    for (const scale of scales) {
      const pnl = dailyPnlData[scale] ?? 0;
      accPnl += pnl;

      data.push({
        value: pnl,
        label: scale,
      });

      accData.push({
        value: accPnl,
        label: scale,
      });
    }

    return {
      data,
      accData,
    };
  }

  private async autoTesting() {
    const initialSlope = 100;
    const power = 1.5;

    for (let base = 1; ; base *= power) {
      const minSlope = Math.floor(base === 1 ? 0 : initialSlope * base);
      const maxSlope = Math.floor(initialSlope * base * power);

      console.time(`${minSlope}-${maxSlope}`);

      for (const pnlSnapshotKind of pnlSnapshotKinds) {
        const r2MinsByPnlSnapshotKind = {
          [PnlSnapshotKind.DAY]: 1,
          [PnlSnapshotKind.TWO_DAY]: 1,
          [PnlSnapshotKind.THREE_DAY]: 1,
          [PnlSnapshotKind.WEEK]: 1,
          [PnlSnapshotKind.TWO_WEEK]: 1,
          [PnlSnapshotKind.MONTH]: 1,
          [PnlSnapshotKind.THREE_MONTH]: 1,
          [PnlSnapshotKind.HALF_YEAR]: 1,
          [PnlSnapshotKind.YEAR]: 1,
          [PnlSnapshotKind.ALL_TIME]: 1,
        };

        console.time(`${minSlope}-${maxSlope}-${pnlSnapshotKind}`);

        for (let r2Min = 0.8; r2Min < 1; r2Min += 0.01) {
          console.time(`${minSlope}-${maxSlope}-${pnlSnapshotKind}-${r2Min}`);
          try {
            r2MinsByPnlSnapshotKind[pnlSnapshotKind] = r2Min;

            const {
              accPnls,
              maxInvested,
              uniqueTraders,
              maxLoss,
              lossCount,
              profitCount,
              avgLoss,
              avgProfit,
              peakPnl,
              bottomPnl,
              maxProfit,
              totalPnls,
            } = await this.getRangeHistories('2024-11-01', 150, [
              {
                r2MinsByPnlSnapshotKind,
                minSlope,
                maxSlope,
              },
            ]);

            const investedUSD = maxInvested;

            const startTimestamp = new Date('2024-11-01').getTime();
            const endTimestamp = new Date('2025-03-31').getTime();

            const dailyScales: string[] = [];

            for (
              let i = startTimestamp;
              i < endTimestamp;
              i += 1000 * 60 * 60 * 24
            ) {
              dailyScales.push(dayjs(i).format('YYYY-MM-DD'));
            }

            const { data: pnlData, accData: accPnlData } = this.getPnlData(
              accPnls,
              dailyScales,
              'YYYY-MM-DD',
            );

            const { data: dailyTaskCountChartData } = this.getPnlData(
              accPnls.map((item) => ({
                pnl: item.taskCount,
                date: item.date,
              })),
              dailyScales,
              'YYYY-MM-DD',
            );

            const { data: dailyPositionCountChartData } = this.getPnlData(
              accPnls.map((item) => ({
                pnl: item.positionCount,
                date: item.date,
              })),
              dailyScales,
              'YYYY-MM-DD',
            );

            const { data: dailyTraderCountChartData } = this.getPnlData(
              accPnls.map((item) => ({
                pnl: item.traderCount,
                date: item.date,
              })),
              dailyScales,
              'YYYY-MM-DD',
            );

            const totalTasks = Object.values(dailyTaskCountChartData).reduce(
              (acc, item) => acc + item.value,
              0,
            );
            const totalPositions = Object.values(
              dailyPositionCountChartData,
            ).reduce((acc, item) => acc + item.value, 0);
            const totalTraders = Object.values(
              dailyTraderCountChartData,
            ).reduce((acc, item) => acc + item.value, 0);

            const usdArr: number[] = accPnlData.map((item) => item.value);
            const xs: number[] = [];

            accPnlData.forEach((_item, index) => xs.push(index));

            const regression = new SimpleLinearRegression(xs, usdArr);
            const score = regression.score(xs, usdArr);

            await this.prismaService.testingReportV2.create({
              data: {
                minSlope,
                maxSlope,
                r2MinsByPnlSnapshotKind: JSON.stringify(
                  r2MinsByPnlSnapshotKind,
                ),
                investedUSD,
                totalUSDPnl: totalPnls,
                totalTasks,
                totalPositions,
                totalTraders,
                totalUniqueTraders: uniqueTraders,
                usdPnls: pnlData.map((item) => item.value),
                calculatedR2: Number.isNaN(score.r2) ? 1 : score.r2,
                calculatedSlope: regression.slope,
                maxLoss,
                lossCount,
                avgLoss,
                maxProfit,
                profitCount,
                avgProfit,
                peakAccProfit: peakPnl,
                bottomAccProfit: bottomPnl,
              },
            });

            console.timeEnd(
              `${minSlope}-${maxSlope}-${pnlSnapshotKind}-${r2Min}`,
            );
          } catch (error) {
            console.error(error);
          }
        }

        console.timeEnd(`${minSlope}-${maxSlope}-${pnlSnapshotKind}`);
        console.log(`${minSlope}-${maxSlope}-${pnlSnapshotKind} done`);
      }

      console.timeEnd(`${minSlope}-${maxSlope}`);
      console.log(`${minSlope}-${maxSlope} done`);

      if (maxSlope > 10000) {
        break;
      }
    }
  }

  async getTestingReportV2(first: number, after: number | null) {
    const records: TestingReportV2[] = after
      ? await this.prismaService.testingReportV2.findMany({
          skip: after ? 1 : undefined,
          take: first,
          cursor: {
            id: after,
          },
        })
      : await this.prismaService.testingReportV2.findMany({
          take: first,
        });

    const edges: TestingReportV2Edge[] = records.map((record) => ({
      cursor: record.id,
      node: record,
    }));

    return {
      edges,
      pageInfo: {
        hasNextPage: edges.length > 0,
        endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
      },
    };
  }
}

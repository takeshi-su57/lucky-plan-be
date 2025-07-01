import { Injectable } from '@nestjs/common';
import {
  PnlSnapshotKind,
  TestingReportV4,
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
  TestingReportV3Edge,
  TotalBot,
  PnlSnapshotDetails,
} from './entities/trade-history.entity';
import { ExportFilterV3 } from './dto/trade-history.input';
import { TradingVariableService } from 'src/global/trading-variable.service';

const timestampGapByPnlSnapshotKind = {
  [PnlSnapshotKind.DAY]: 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.WEEK]: 7 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.MONTH]: 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.THREE_MONTH]: 3 * 30 * 24 * 60 * 60 * 1000,
  [PnlSnapshotKind.ALL_TIME]: 10 * 365 * 24 * 60 * 60 * 1000,
};

const MIN_SLOPE = 150;

type ExportFilterV4Params = {
  minR2: number;
  minCount: number;
  maxCount: number;
  minSize: number;
  maxSize: number;
};

@Injectable()
export class BacktestV4Service {
  status: 'processing' | 'ready' = 'ready';

  constructor(
    private prismaService: PrismaService,
    private tradingVariableService: TradingVariableService,
  ) {
    // this.autoTesting();
  }

  private getPnlSnapshotDevDetails(
    snapshot: PnlSnapshot,
    histories: TradeHistory[],
    params: ExportFilterV4Params[],
  ): PnlSnapshotDevDetails | null {
    const timestampGap = timestampGapByPnlSnapshotKind[snapshot.kind];

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
    const sumIn = openHistories.reduce((acc, history) => {
      return acc + +history.size * +history.collateralPriceUsd;
    }, 0);
    const countIn = openHistories.length;

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

    const valideTradeIndexMap: Record<string, boolean> = {};

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
        valideTradeIndexMap[
          `${history.contractId}-${history.address}-${history.tradeIndex}`
        ] = true;
      }
    });

    const historiesByTradeIndex: Record<string, TradeHistory[]> = {};

    sortedHistories.forEach((history) => {
      if (
        !valideTradeIndexMap[
          `${history.contractId}-${history.address}-${history.tradeIndex}`
        ]
      ) {
        return;
      }

      if (
        !historiesByTradeIndex[
          `${history.contractId}-${history.address}-${history.tradeIndex}`
        ]
      ) {
        historiesByTradeIndex[
          `${history.contractId}-${history.address}-${history.tradeIndex}`
        ] = [];
      }

      historiesByTradeIndex[
        `${history.contractId}-${history.address}-${history.tradeIndex}`
      ].push(history);
    });

    return Object.values(historiesByTradeIndex)
      .flat()
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  private async getDayDevPnlSnapshots(
    dateStr: string,
    params: ExportFilterV4Params[],
    ratio: number,
  ): Promise<PnlSnapshotDetails[]> {
    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        where: {
          dateStr,
          accUSDPnl: {
            gt: 100,
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
          nodes.push({
            ...detail,
            histories: allHistories.map((history) => {
              return {
                ...history,
                size: `${Number(history.size) * ratio}`,
                pnl: `${Number(history.pnl) * ratio}`,
                collateralDelta: history.collateralDelta
                  ? `${Number(history.collateralDelta) * ratio}`
                  : null,
              };
            }),
          });
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
    params: ExportFilterV4Params[],
    ratio: number,
    isTestnet: boolean,
  ): Promise<{
    accPnls: AccPnl[];
    botCounts: BotCount[];
    histories: TradeHistory[];
    maxInvested: number;
    uniqueTraders: string[];
    maxLoss: number;
    avgLoss: number;
    maxProfit: number;
    avgProfit: number;
    bottomPnl: number;
    peakPnl: number;
    lossCount: number;
    profitCount: number;
    totalPnls: number;
    totalBots: TotalBot[];
    actionTypeCount: Record<string, number>;
  }> {
    const dateStrs: string[] = [];

    for (let i = 0; i < days; i++) {
      dateStrs.push(dayjs(dateStr).add(i, 'days').format('YYYY-MM-DD'));
    }

    const allPairs = isTestnet
      ? await this.tradingVariableService.getTradePairs(isTestnet ? 4 : 0)
      : [];

    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        where: {
          dateStr: {
            in: dateStrs,
          },
          accUSDPnl: {
            gt: 100,
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

    const CHUNK = 35;
    const totalResultHistories: TradeHistory[] = [];
    const botCountData: Record<string, number> = {};
    const totalBots: {
      dateStr: string;
      contractId: number;
      address: string;
    }[] = [];

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

        nodes.forEach((node) => {
          const dateStr = node.dateStr;

          botCountData[dateStr] = (botCountData[dateStr] || 0) + 1;
          totalBots.push({
            dateStr: node.dateStr,
            contractId: node.contractId,
            address: node.address,
          });

          const startDate = new Date(
            new Date(dateStr).getTime() + 24 * 3600 * 1000,
          );
          const endDate = new Date(startDate.getTime() + 48 * 3600 * 1000);

          const histories = this.getSortedPartialHistories(
            node.histories,
            startDate,
            endDate,
          );

          const availablePairNames = allPairs.map((pair) =>
            `${pair.from}/${pair.to}`.toLowerCase(),
          );

          const supportedPairsMap: Record<string, boolean> = {};

          availablePairNames.forEach((pair) => {
            supportedPairsMap[pair.toLowerCase()] = true;
          });

          const transformedHistories = histories
            .filter((history) =>
              isTestnet ? supportedPairsMap[history.pair.toLowerCase()] : true,
            )
            .map((history) => {
              return {
                ...history,
                size: `${Number(history.size) * ratio}`,
                pnl: `${Number(history.pnl) * ratio}`,
                collateralDelta: history.collateralDelta
                  ? `${Number(history.collateralDelta) * ratio}`
                  : null,
              };
            });

          totalResultHistories.push(...transformedHistories);
        });
      });
    }

    const accInData: Record<string, number> = {};
    const accOutData: Record<string, number> = {};
    const accPnlData: Record<string, number> = {};
    const accInOutData: Record<string, number> = {};
    const taskCountData: Record<string, number> = {};
    const positionCountData: Record<string, Record<string, boolean>> = {};
    const actionTypeCount: Record<string, number> = {};

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

        actionTypeCount[history.action] =
          (actionTypeCount[history.action] ?? 0) + 1;

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

    return {
      accPnls,
      botCounts,
      histories: totalResultHistories,
      maxInvested,
      uniqueTraders: Object.keys(uniqueTraders),
      actionTypeCount,
      maxLoss,
      maxProfit,
      bottomPnl,
      peakPnl,
      lossCount,
      profitCount,
      avgLoss: lossCount > 0 ? accPnlLoss / lossCount : 0,
      avgProfit: profitCount > 0 ? accPnlProfit / profitCount : 0,
      totalPnls: accPnl,
      totalBots,
    };
  }

  // initial params for test case 1
  private getTestParam(filterParams: ExportFilterV3[]): ExportFilterV4Params[] {
    return filterParams.map((item) => ({
      minR2: item.minR2,
      minCount: item.minCount,
      maxCount: item.maxCount,
      minSize: item.minSize,
      maxSize: item.maxSize,
    }));
  }

  async getDevPnlSnapshotsV4(
    dateStr: string,
    filterParams: ExportFilterV3[],
    ratio: number,
  ) {
    return this.getDayDevPnlSnapshots(
      dateStr,
      this.getTestParam(filterParams),
      ratio,
    );
  }

  async getWholeCompressedHistoriesV4(
    startDate: string,
    filterParams: ExportFilterV3[],
    ratio: number,
    isTestnet: boolean,
  ) {
    console.time('getWholeCompressedHistories==============>');

    const dayGaps = dayjs(new Date()).diff(dayjs(startDate), 'day');

    const {
      accPnls,
      actionTypeCount,
      uniqueTraders,
      botCounts,
      maxInvested,
      totalBots,
    } = await this.getRangeHistories(
      startDate,
      dayGaps,
      this.getTestParam(filterParams),
      ratio,
      isTestnet,
    );

    console.timeEnd('getWholeCompressedHistories==============>');

    return {
      accPnls,
      botCounts,
      maxInvested,
      uniqueTraders,
      actionTypeCount: JSON.stringify(actionTypeCount),
      totalBots,
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

  async getTestingReportV4(first: number, after: number | null) {
    const records: TestingReportV4[] = after
      ? await this.prismaService.testingReportV4.findMany({
          skip: after ? 1 : undefined,
          take: first,
          cursor: {
            id: after,
          },
        })
      : await this.prismaService.testingReportV4.findMany({
          take: first,
        });

    const edges: TestingReportV3Edge[] = records.map((record) => ({
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

  async autoTesting(startDate: string): Promise<boolean> {
    const sizeScales = [
      714, 928, 1189, 1567, 2248, 3500, 4903, 8868, 100000000,
    ];
    const countScales = [4, 6, 9, 13, 19, 28, 39, 56, 89, 152, 351, 1000000000];

    const dayGaps = dayjs(new Date()).diff(dayjs(startDate), 'day');

    await this.prismaService.testingReportV4.deleteMany();

    for (let i = 1; i < countScales.length; i++) {
      const minCount = countScales[i - 1];
      const maxCount = countScales[i];

      for (let j = 1; j < sizeScales.length; j++) {
        const minSize = sizeScales[j - 1];
        const maxSize = sizeScales[j];

        for (let r2Min = 0.7; r2Min < 1; r2Min += 0.02) {
          console.log(`${minCount}-${maxCount}-${minSize}-${maxSize}-${r2Min}`);
          console.time(
            `${minCount}-${maxCount}-${minSize}-${maxSize}-${r2Min}`,
          );

          try {
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
            } = await this.getRangeHistories(
              startDate,
              dayGaps,
              [
                {
                  minR2: r2Min,
                  minCount,
                  maxCount,
                  minSize,
                  maxSize,
                },
              ],
              1,
              false,
            );

            const investedUSD = maxInvested;

            const startTimestamp = new Date(startDate).getTime();
            const endTimestamp =
              new Date(startDate).getTime() + dayGaps * 1000 * 60 * 60 * 24;

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

            await this.prismaService.testingReportV4.create({
              data: {
                minSize,
                maxSize,
                minCount,
                maxCount,
                minR2: r2Min.toString(),
                investedUSD,
                totalUSDPnl: totalPnls,
                totalTasks,
                totalPositions,
                totalTraders,
                totalUniqueTraders: uniqueTraders.length,
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
              `${minCount}-${maxCount}-${minSize}-${maxSize}-${r2Min}`,
            );
          } catch (error) {
            console.error(error);
          }
        }

        console.log(`Done ${minCount}-${maxCount} ${minSize}-${maxSize}`);
      }

      console.log(`Done ${minCount}-${maxCount}`);
    }

    console.log('Finished');

    return true;
  }
}

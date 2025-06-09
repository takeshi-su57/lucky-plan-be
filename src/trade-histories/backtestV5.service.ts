import { Injectable } from '@nestjs/common';
import {
  PnlSnapshotKind,
  TestingReportV5,
  TradeActionType,
  TradeHistory,
} from '@prisma/client';
import * as dayjs from 'dayjs';
import { SimpleLinearRegression } from 'ml-regression-simple-linear';

import { PrismaService } from 'src/global/prisma.service';
import { getStartOfDay } from 'src/utils';
import {
  AccPnl,
  PnlSnapshot,
  BotCount,
  TotalBot,
  PnlSnapshotDetails,
  PnlSnapshotDevDetailsV5,
  TestingReportV5Edge,
  WholeCompressedHistories,
} from './entities/trade-history.entity';
import { TradingVariableService } from 'src/global/trading-variable.service';
import { ExportFilterV5 } from './dto/trade-history.input';

const dailyPlans = 8;

@Injectable()
export class BacktestV5Service {
  status: 'processing' | 'ready' = 'ready';
  private cache: WholeCompressedHistories | null = null;
  private cachedDateStr: string | null = null;

  constructor(
    private prismaService: PrismaService,
    private tradingVariableService: TradingVariableService,
  ) {
    // this.autoTesting();

    this.cache = null;
    this.cachedDateStr = null;
  }

  private getPnlSnapshotDevDetails(
    startDate: Date,
    endDate: Date,
    snapshot: PnlSnapshot,
    histories: TradeHistory[],
    params: ExportFilterV5,
  ): PnlSnapshotDevDetailsV5 {
    // const endDate = new Date(
    //   getStartOfDay(new Date(snapshot.dateStr)).getTime() + 24 * 3600 * 1000,
    // );

    const rangeHistories = histories.filter((history) => {
      const historyDate = new Date(history.date);

      return (
        historyDate.getTime() <= endDate.getTime() &&
        historyDate.getTime() >= startDate.getTime()
      );
    });

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
      return {
        ...snapshot,
        histories,
        score: 0,
      };
    }

    let traderScore = 0;

    for (let step = 0; step < params.window; step++) {
      let round = 0;
      let stepScore = 0;

      for (let i = 0; i < closeHistories.length; i += params.window) {
        round++;
        const chunk = closeHistories.slice(
          Math.max(closeHistories.length - i - step - params.window, 0),
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
          if (score.r2 > params.minR2) {
            stepScore += (regression.slope * score.r2) / round / params.n;
          } else {
            stepScore +=
              (regression.slope * (score.r2 - 1) * params.m) / round / params.n;
          }
        } else {
          stepScore +=
            (regression.slope * (2 - score.r2) * params.m) / round / params.n;
        }
      }

      traderScore += stepScore;
    }

    return {
      ...snapshot,
      histories,
      score: (traderScore * closeHistories.length) / params.window,
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
    params: ExportFilterV5,
  ): Promise<PnlSnapshotDetails[]> {
    const pnlRecords: PnlSnapshot[] =
      await this.prismaService.pnlSnapshot.findMany({
        where: {
          dateStr,
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

    const CHUNK = 100;

    const nodes: PnlSnapshotDevDetailsV5[] = [];

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
          new Date('2024-01-01'),
          new Date(
            getStartOfDay(new Date(record.dateStr)).getTime() +
              24 * 3600 * 1000,
          ),
          record,
          allHistories,
          params,
        );

        if (detail.score > params.minScore) {
          nodes.push({
            ...detail,
            histories: allHistories,
          });
        }
      });

      console.log(
        `Ended chunk ${i / CHUNK + 1} of ${Math.ceil(pnlRecords.length / CHUNK)}`,
      );
    }

    console.log('total leaders ==>', nodes.length);

    return nodes.sort((a, b) => b.score - a.score).slice(0, 100);
  }

  async getDevPnlSnapshotsV5(dateStr: string, params: ExportFilterV5) {
    return this.getDayDevPnlSnapshots(dateStr, params);
  }

  private async getRangeHistories(
    dateStr: string,
    days: number,
    params: ExportFilterV5,
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

        const nodes: (PnlSnapshotDevDetailsV5 & {
          endDate: Date;
        })[] = [];

        subPnlRecords.forEach((record) => {
          for (let divider = dailyPlans; divider > 0; divider--) {
            const detail = this.getPnlSnapshotDevDetails(
              new Date('2024-01-01'),
              new Date(
                getStartOfDay(new Date(record.dateStr)).getTime() +
                  (24 * 3600 * 1000) / divider,
              ),
              record,
              allHistories,
              params,
            );

            if (detail.score > params.minScore) {
              nodes.push({
                ...detail,
                endDate: new Date(
                  getStartOfDay(new Date(record.dateStr)).getTime() +
                    (24 * 3600 * 1000) / divider,
                ),
              });
            }
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

          const startDate = node.endDate;
          const endDate = new Date(
            startDate.getTime() + (24 * 3600 * 1000) / dailyPlans + 1800 * 1000,
          );

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

  private async getRangeHistoriesForRecord(
    dateStr: string,
    days: number,
    params: ExportFilterV5,
    dnaParams: {
      weekWeight: number;
      monthWeight: number;
      threeMonthWeight: number;
      allTimeWeight: number;
    },
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

        const nodes: (PnlSnapshotDevDetailsV5 & {
          endDate: Date;
        })[] = [];

        subPnlRecords.forEach((record) => {
          for (let divider = dailyPlans; divider > 0; divider--) {
            const weekDetail = this.getPnlSnapshotDevDetails(
              new Date(
                getStartOfDay(new Date(record.dateStr)).getTime() +
                  (24 * 3600 * 1000) / divider -
                  7 * 24 * 3600 * 1000,
              ),
              new Date(
                getStartOfDay(new Date(record.dateStr)).getTime() +
                  (24 * 3600 * 1000) / divider,
              ),
              record,
              allHistories,
              params,
            );

            const monthDetail = this.getPnlSnapshotDevDetails(
              new Date(
                getStartOfDay(new Date(record.dateStr)).getTime() +
                  (24 * 3600 * 1000) / divider -
                  30 * 24 * 3600 * 1000,
              ),
              new Date(
                getStartOfDay(new Date(record.dateStr)).getTime() +
                  (24 * 3600 * 1000) / divider,
              ),
              record,
              allHistories,
              params,
            );

            const threeMonthDetails = this.getPnlSnapshotDevDetails(
              new Date(
                getStartOfDay(new Date(record.dateStr)).getTime() +
                  (24 * 3600 * 1000) / divider -
                  90 * 24 * 3600 * 1000,
              ),
              new Date(
                getStartOfDay(new Date(record.dateStr)).getTime() +
                  (24 * 3600 * 1000) / divider,
              ),
              record,
              allHistories,
              params,
            );

            const allTimeDetails = this.getPnlSnapshotDevDetails(
              new Date('2024-01-01'),
              new Date(
                getStartOfDay(new Date(record.dateStr)).getTime() +
                  (24 * 3600 * 1000) / divider,
              ),
              record,
              allHistories,
              params,
            );

            const sumScore =
              (weekDetail?.score || 0) * dnaParams.weekWeight +
              (monthDetail?.score || 0) * dnaParams.monthWeight +
              (threeMonthDetails?.score || 0) * dnaParams.threeMonthWeight +
              (allTimeDetails?.score || 0) * dnaParams.allTimeWeight;

            if (sumScore > params.minScore) {
              nodes.push({
                ...allTimeDetails,
                endDate: new Date(
                  getStartOfDay(new Date(record.dateStr)).getTime() +
                    (24 * 3600 * 1000) / divider,
                ),
                score: sumScore,
              });
            }
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

          const startDate = node.endDate;
          const endDate = new Date(
            startDate.getTime() + (24 * 3600 * 1000) / dailyPlans + 1800 * 1000,
          );

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

  async getWholeCompressedHistoriesV5(
    startDate: string,
    params: ExportFilterV5,
    ratio: number,
    isTestnet: boolean,
  ) {
    if (this.cachedDateStr === startDate && this.cache) {
      return this.cache;
    }

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
      params,
      ratio,
      isTestnet,
    );

    console.timeEnd('getWholeCompressedHistories==============>');

    this.cache = {
      accPnls,
      botCounts,
      maxInvested,
      uniqueTraders,
      actionTypeCount: JSON.stringify(actionTypeCount),
      totalBots,
    };
    this.cachedDateStr = startDate;

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

  async getTestingReportV5(first: number, after: number | null) {
    const records: TestingReportV5[] = after
      ? await this.prismaService.testingReportV5.findMany({
          skip: after ? 1 : undefined,
          take: first,
          cursor: {
            id: after,
          },
        })
      : await this.prismaService.testingReportV5.findMany({
          take: first,
        });

    const edges: TestingReportV5Edge[] = records.map((record) => ({
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

  private async handleSingleCase(
    startDate: string,
    dayGaps: number,
    params: ExportFilterV5,
    dnaParams: {
      weekWeight: number;
      monthWeight: number;
      threeMonthWeight: number;
      allTimeWeight: number;
    },
  ) {
    console.time(
      `${params.window}-${params.minR2}-${params.n}-${params.m}-${params.minScore}`,
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
      } = await this.getRangeHistoriesForRecord(
        startDate,
        dayGaps,
        params,
        dnaParams,
        1,
        false,
      );

      const investedUSD = maxInvested;

      const startTimestamp = new Date(startDate).getTime();
      const endTimestamp =
        new Date(startDate).getTime() + dayGaps * 1000 * 60 * 60 * 24;

      const dailyScales: string[] = [];

      for (let i = startTimestamp; i < endTimestamp; i += 1000 * 60 * 60 * 24) {
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
      const totalPositions = Object.values(dailyPositionCountChartData).reduce(
        (acc, item) => acc + item.value,
        0,
      );
      const totalTraders = Object.values(dailyTraderCountChartData).reduce(
        (acc, item) => acc + item.value,
        0,
      );

      const usdArr: number[] = accPnlData.map((item) => item.value);
      const xs: number[] = [];

      accPnlData.forEach((_item, index) => xs.push(index));

      const regression = new SimpleLinearRegression(xs, usdArr);
      const score = regression.score(xs, usdArr);

      await this.prismaService.testingReportV5.create({
        data: {
          window: params.window,
          minR2: params.minR2,
          weekWeight: dnaParams.weekWeight,
          monthWeight: dnaParams.monthWeight,
          threeMonthWeight: dnaParams.threeMonthWeight,
          allTimeWeight: dnaParams.allTimeWeight,
          n: params.n,
          m: params.m,
          minScore: params.minScore,
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
        `${params.window}-${params.minR2}-${params.n}-${params.m}-${params.minScore}`,
      );
    } catch (error) {
      console.error(error);
    }
  }

  async autoTesting(): Promise<boolean> {
    const startDates = ['2024-11-01', '2025-03-01'];

    const windowScales = [6, 9, 12, 38];
    const penaltyScales = [1, 34];
    const dnaParams = [
      {
        weekWeight: 0,
        monthWeight: 0,
        threeMonthWeight: 0,
        allTimeWeight: 1,
      },
      {
        weekWeight: 1,
        monthWeight: 1,
        threeMonthWeight: 1,
        allTimeWeight: 1,
      },
      {
        weekWeight: 4,
        monthWeight: 3,
        threeMonthWeight: 2,
        allTimeWeight: 1,
      },
      {
        weekWeight: 30,
        monthWeight: 15,
        threeMonthWeight: 5,
        allTimeWeight: 1,
      },
      {
        weekWeight: 1000,
        monthWeight: 100,
        threeMonthWeight: 10,
        allTimeWeight: 1,
      },
      {
        weekWeight: 9,
        monthWeight: 6,
        threeMonthWeight: 3,
        allTimeWeight: 1,
      },
    ];

    await this.prismaService.testingReportV5.deleteMany();

    for (let i = 0; i < dnaParams.length; i++) {
      for (const window of windowScales) {
        for (const penalty of penaltyScales) {
          for (const startDate of startDates) {
            const dayGaps = dayjs(new Date()).diff(dayjs(startDate), 'day');

            await this.handleSingleCase(
              startDate,
              dayGaps,
              {
                window,
                minR2: 0.9,
                n: 2,
                m: penalty,
                minScore: 10,
              },
              dnaParams[i],
            );
          }

          console.log(`Done penalty ${penalty}`);
        }

        console.log(`Done window ${window}`);
      }
      console.log(`Done dna ${i}`);
    }

    console.log('Finished');

    return true;
  }
}

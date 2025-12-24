import { Injectable } from '@nestjs/common';
import {
  PnlSnapshotKind,
  Platform,
  PnlSnapshotV2,
  Contract,
} from 'generated/prisma/client';
import * as dayjs from 'dayjs';
import { SimpleLinearRegression } from 'ml-regression-simple-linear';

import {
  AccPnlV2,
  BotCount,
  PnlSnapshotDevDetailsV2,
} from './entities/trade-history.entity';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
} from './entities/event-logs.entity';
import { ExportFilter } from './dto/event-logs.input';
import { WholeCompressedHistoriesV2 } from './entities/trade-history.entity';

import { getStartOfDay } from 'src/utils';

import { PrismaService } from 'src/global/prisma.service';
import { LogsService } from 'src/global/logs.service';
import { getWeb3Info } from 'src/web3/utils';

const dailyPlans = 8;

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
export class BacktestService {
  status: 'processing' | 'ready' = 'ready';
  private cache: WholeCompressedHistoriesV2 | null = null;
  private cachedDateStr: string | null = null;
  private blacklist: string[] = [];

  constructor(
    private prismaService: PrismaService,
    // private gnsService: GnsService,
    private logger: LogsService,
  ) {
    // setTimeout(() => {
    //   this.autoTesting();
    // }, 30_000);
    this.cache = null;
    this.cachedDateStr = null;
  }

  async init() {
    // await this.autoTesting();
  }

  private getPnlSnapshotDevDetails(
    startDate: Date,
    endDate: Date,
    snapshot: PnlSnapshotV2,
    histories: (PerpTradeHistory & { date: Date })[],
    params: ExportFilter,
  ): PnlSnapshotDevDetailsV2 {
    if (this.blacklist.includes(snapshot.address.toLowerCase())) {
      return {
        ...snapshot,
        histories,
        score: 0,
      };
    }

    const oneMonthStartDate = dayjs(endDate).subtract(1, 'month').toDate();

    const rangeHistories = histories.filter((history) => {
      const historyDate = new Date(history.date);

      return (
        historyDate.getTime() <= endDate.getTime() &&
        historyDate.getTime() >= startDate.getTime()
      );
    });

    const totalOpenHistories = rangeHistories.filter(
      (history) => history.operation === PerpTradeHistoryOperation.OPEN,
    );

    const isLatestTrader = totalOpenHistories.find((history) => {
      const historyDate = new Date(history.date);

      return (
        historyDate.getTime() >= oneMonthStartDate.getTime() &&
        historyDate.getTime() <= endDate.getTime()
      );
    });

    if (
      !isLatestTrader ||
      totalOpenHistories.length < params.minCount ||
      totalOpenHistories.length > params.maxCount
    ) {
      return {
        ...snapshot,
        histories,
        score: 0,
      };
    }

    const openHistories = totalOpenHistories.reverse().slice(0, 512);

    const totalSize = openHistories.reduce((acc, history) => {
      return acc + history.collateralInUsd;
    }, 0);

    const avgSize = totalSize / openHistories.length;

    if (avgSize < params.minAvgSize || avgSize > params.maxAvgSize) {
      return {
        ...snapshot,
        histories,
        score: 0,
      };
    }

    const closeHistories = rangeHistories
      .filter((history) => {
        return (
          history.operation === PerpTradeHistoryOperation.CLOSE ||
          history.operation === PerpTradeHistoryOperation.DECREASE_SIZE
        );
      })
      .filter((history) => +history.usdPnl !== 0);

    if (closeHistories.length < 6) {
      return {
        ...snapshot,
        histories,
        score: 0,
      };
    }

    let openedPositions = 0;
    let totalDuration = 0;
    let totalPositions = 0;
    let sumOfPnl = 0;
    let sumOfSize = 0;

    const groupedByPositionKey: Record<
      string,
      (PerpTradeHistory & { date: Date })[]
    > = {};

    rangeHistories
      .slice(Math.max(0, rangeHistories.length - 512), rangeHistories.length)
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

        if (history.operation !== PerpTradeHistoryOperation.OPEN) {
          continue;
        }

        openedPositions++;
        totalPositions++;

        sumOfSize += history.sizeInUsd;

        for (let j = i; j < histories.length; j++) {
          const nextHistory = histories[j];

          sumOfPnl += +nextHistory.usdPnl;

          if (nextHistory.operation === PerpTradeHistoryOperation.CLOSE) {
            openedPositions--;

            totalDuration +=
              histories[j].date.getTime() - history.date.getTime();
            break;
          }
        }
      }
    }

    // if trader holds too many positions, skip
    if (openedPositions > 10) {
      return {
        ...snapshot,
        histories,
        score: 0,
      };
    }

    const avgDuration = totalPositions > 0 ? totalDuration / totalPositions : 0;

    if (avgDuration < 1000 * 3 * 60) {
      return {
        ...snapshot,
        histories,
        score: 0,
      };
    }

    if (sumOfSize > 0) {
      const avgPnlP = (sumOfPnl / sumOfSize) * 100;

      if (avgPnlP < 0.5) {
        return {
          ...snapshot,
          histories,
          score: 0,
        };
      }
    }

    let traderScore = 0;

    // const minR2 = getMinR2(avgSize, totalOpenHistories.length);

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
    histories: (PerpTradeHistory & { date: Date })[],
    startDate: Date,
    endDate: Date,
  ): (PerpTradeHistory & { date: Date })[] {
    const sortedHistories = histories.sort((a, b) => {
      const aDate = new Date(a.date);
      const bDate = new Date(b.date);

      return aDate.getTime() - bDate.getTime();
    });

    const groupedByPositionKey: Record<
      string,
      (PerpTradeHistory & { date: Date })[]
    > = {};

    sortedHistories.forEach((history) => {
      if (startDate && startDate > new Date(history.date)) {
        return;
      }

      if (endDate && endDate < new Date(history.date)) {
        return;
      }

      if (groupedByPositionKey[history.positionKey]) {
        groupedByPositionKey[history.positionKey].push(history);
      } else {
        groupedByPositionKey[history.positionKey] = [history];
      }
    });

    const validPerpTradeHistories: (PerpTradeHistory & { date: Date })[] = [];

    for (const histories of Object.values(groupedByPositionKey)) {
      for (let i = 0; i < histories.length; i++) {
        const history = histories[i];

        if (history.operation !== PerpTradeHistoryOperation.OPEN) {
          continue;
        }

        const tempHistories: (PerpTradeHistory & { date: Date })[] = [];

        for (let j = i; j < histories.length; j++) {
          const nextHistory = histories[j];

          tempHistories.push(nextHistory);

          if (nextHistory.operation === PerpTradeHistoryOperation.CLOSE) {
            break;
          }
        }

        validPerpTradeHistories.push(...tempHistories);
      }
    }

    return validPerpTradeHistories.sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }

  private async getRangeHistories(
    platform: Platform,
    dateStr: string,
    days: number,
    params: ExportFilter[],
  ) {
    const dateStrs: string[] = [];

    for (let i = 0; i < days; i++) {
      dateStrs.push(dayjs(dateStr).add(i, 'days').format('YYYY-MM-DD'));
    }

    const allContracts = await this.prismaService.contract.findMany();

    const contractsMap = new Map<number, Contract>();

    allContracts.forEach((item) => {
      contractsMap.set(item.id, item);
    });

    const testContractIds = allContracts
      .filter((item) => item.isTestnet)
      .map((item) => item.id);

    const pnlRecords: PnlSnapshotV2[] =
      await this.prismaService.pnlSnapshotV2.findMany({
        where: {
          dateStr: {
            in: dateStrs,
          },
          accUSDPnl: {
            gt: 500,
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

    const pnlSnapshotsMap = new Map<string, PnlSnapshotV2[]>();

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

    console.log('pnlSnapshotsMapKeys', pnlSnapshotsMapKeys.length);
    console.log('pnlRecords', pnlRecords.length);

    const CHUNK = 50;
    const totalResultHistories: (PerpTradeHistory & { date: Date })[] = [];
    const botCountData: Record<string, number> = {};
    const totalBots: {
      dateStr: string;
      platform: Platform;
      address: string;
    }[] = [];

    for (let i = 0; i < pnlSnapshotsMapKeys.length; i += CHUNK) {
      const chunk = pnlSnapshotsMapKeys.slice(i, i + CHUNK);

      const perpLogs = await this.prismaService.perpTradingEventLog.findMany({
        where: {
          OR: [
            ...chunk
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

      let historiesCount = 0;
      const perpLogsMap = new Map<
        string,
        (PerpTradeHistory & { date: Date })[]
      >();

      perpLogs.forEach((record) => {
        const key = record.address;

        const arr = perpLogsMap.get(key);

        const contract = contractsMap.get(record.contractId);

        if (!contract) {
          console.log('cannot find contract', record.contractId);

          return;
        }

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

        historiesCount++;

        if (arr) {
          arr.push({
            ...history,
            date: record.date,
          });
        } else {
          perpLogsMap.set(key, [
            {
              ...history,
              date: record.date,
            },
          ]);
        }
      });

      console.log('chunk', i, i + CHUNK);
      console.log('perpLogs', perpLogs.length);
      console.log('perptradehistories', historiesCount);

      chunk.forEach((key) => {
        const item = JSON.parse(key) as { address: string; platform: Platform };

        const subPnlRecords = pnlSnapshotsMap.get(key) || [];
        const allHistories = perpLogsMap.get(item.address) || [];

        const nodes: (PnlSnapshotDevDetailsV2 & {
          endDate: Date;
          ratio: number;
        })[] = [];

        subPnlRecords.forEach((record) => {
          for (let divider = dailyPlans; divider > 0; divider--) {
            for (const param of params) {
              const detail = this.getPnlSnapshotDevDetails(
                new Date('2024-01-01'),
                new Date(
                  getStartOfDay(new Date(record.dateStr)).getTime() +
                    (24 * 3600 * 1000) / divider,
                ),
                record,
                allHistories,
                param,
              );

              if (detail.score > param.minScore) {
                nodes.push({
                  ...detail,
                  endDate: new Date(
                    getStartOfDay(new Date(record.dateStr)).getTime() +
                      (24 * 3600 * 1000) / divider,
                  ),
                  ratio: param.ratio,
                });
              }
            }
          }
        });

        nodes.forEach((node) => {
          const dateStr = node.dateStr;

          botCountData[dateStr] = (botCountData[dateStr] || 0) + 1;
          totalBots.push({
            dateStr: node.dateStr,
            platform: node.platform,
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

          totalResultHistories.push(...histories);
        });
      });
    }

    const accInData: Record<string, number> = {};
    const accOutData: Record<string, number> = {};
    const accPnlData: Record<string, number> = {};
    const accInOutData: Record<string, number> = {};
    const taskCountData: Record<string, number> = {};
    const positionCountData: Record<string, number> = {};

    const uniqueTraders: Record<string, boolean> = {};

    let accInOut = 0;
    let maxInvested = 0;

    let accPnl = 0;

    const groupedByPositionKey: Record<
      string,
      (PerpTradeHistory & { date: Date })[]
    > = {};

    totalResultHistories
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .forEach((history) => {
        if (groupedByPositionKey[history.positionKey]) {
          groupedByPositionKey[history.positionKey].push(history);
        } else {
          groupedByPositionKey[history.positionKey] = [history];
        }
      });

    for (const histories of Object.values(groupedByPositionKey)) {
      for (let i = 0; i < histories.length; i++) {
        const openedHistory = histories[i];

        if (openedHistory.operation !== PerpTradeHistoryOperation.OPEN) {
          continue;
        }

        const date = dayjs(openedHistory.date).format(
          'YYYY-MM-DD HH:[00]:[00]',
        );

        positionCountData[date] = (positionCountData[date] ?? 0) + 1;

        for (let j = i; j < histories.length; j++) {
          const history = histories[j];

          const date = dayjs(history.date).format('YYYY-MM-DD HH:[00]:[00]');
          const usdPnl = +history.usdPnl;

          accPnl += usdPnl;

          accPnlData[date] = (accPnlData[date] ?? 0) + usdPnl;
          taskCountData[date] = (taskCountData[date] ?? 0) + 1;
          uniqueTraders[history.address.toLowerCase()] = true;

          switch (history.operation) {
            case PerpTradeHistoryOperation.OPEN: {
              accInOutData[date] =
                (accInOutData[date] ?? 0) + -history.collateralInUsd;
              accInOut = accInOut + -history.collateralInUsd;

              accInData[date] =
                (accInData[date] ?? 0) + history.collateralInUsd;

              break;
            }
            case PerpTradeHistoryOperation.CLOSE: {
              const inOut = history.usdPnl + history.collateralDeltaUsd;

              accInOutData[date] = (accInOutData[date] ?? 0) + inOut;
              accInOut = accInOut + inOut;

              accOutData[date] = (accOutData[date] ?? 0) + inOut;

              break;
            }
            case PerpTradeHistoryOperation.INCREASE_LEVERAGE: {
              accInOutData[date] =
                (accInOutData[date] ?? 0) + history.collateralDeltaUsd;

              accOutData[date] =
                (accOutData[date] ?? 0) + history.collateralDeltaUsd;
              accInOut = accInOut + history.collateralDeltaUsd;

              break;
            }
            case PerpTradeHistoryOperation.DECREASE_LEVERAGE: {
              accInOutData[date] =
                (accInOutData[date] ?? 0) - history.collateralDeltaUsd;

              accInData[date] =
                (accInData[date] ?? 0) + history.collateralDeltaUsd;
              accInOut = accInOut - history.collateralDeltaUsd;

              break;
            }
            case PerpTradeHistoryOperation.INCREASE_SIZE: {
              accInOutData[date] =
                (accInOutData[date] ?? 0) +
                (history.collateralDeltaUsd + history.usdPnl);

              accInOut =
                accInOut - (history.collateralDeltaUsd + history.usdPnl);

              accInData[date] =
                (accInData[date] ?? 0) +
                history.collateralDeltaUsd +
                history.usdPnl;

              break;
            }
            case PerpTradeHistoryOperation.DECREASE_SIZE: {
              accInOutData[date] =
                (accInOutData[date] ?? 0) +
                (history.collateralDeltaUsd + history.usdPnl);

              accInOut =
                accInOut + (history.collateralDeltaUsd + history.usdPnl);

              accOutData[date] =
                (accOutData[date] ?? 0) +
                (history.collateralDeltaUsd + history.usdPnl);

              break;
            }
          }

          maxInvested = Math.min(maxInvested, accInOut);

          if (history.operation === PerpTradeHistoryOperation.CLOSE) {
            break;
          }
        }
      }
    }

    const accPnls: AccPnlV2[] = Object.entries(accPnlData)
      .map(([date, pnl]) => ({
        date: dayjs(date).toDate(),
        pnl,
        in: accInData[date] ?? 0,
        out: accOutData[date] ?? 0,
        inOut: accInOutData[date] ?? 0,
        taskCount: taskCountData[date] ?? 0,
        positionCount: positionCountData[date] ?? 0,
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
      maxInvested,
      uniqueTraders: Object.keys(uniqueTraders),
      totalBots,
    };
  }

  // private async getRangeHistoriesForRecord(
  //   dateStr: string,
  //   days: number,
  //   params: ExportFilter,
  //   isTestnet: boolean,
  // ): Promise<{
  //   accPnls: AccPnl[];
  //   botCounts: BotCount[];
  //   histories: TradeHistory[];
  //   maxInvested: number;
  //   uniqueTraders: string[];
  //   maxLoss: number;
  //   avgLoss: number;
  //   maxProfit: number;
  //   avgProfit: number;
  //   bottomPnl: number;
  //   peakPnl: number;
  //   lossCount: number;
  //   profitCount: number;
  //   totalPnls: number;
  //   totalBots: TotalBot[];
  //   actionTypeCount: Record<string, number>;
  // }> {
  //   const dateStrs: string[] = [];

  //   for (let i = 0; i < days; i++) {
  //     dateStrs.push(dayjs(dateStr).add(i, 'days').format('YYYY-MM-DD'));
  //   }

  //   const contracts = await this.prismaService.contract.findMany({
  //     where: {
  //       platform: Platform.GNS,
  //       isTestnet: false,
  //     },
  //   });

  //   const pnlRecords: PnlSnapshot[] =
  //     await this.prismaService.pnlSnapshot.findMany({
  //       where: {
  //         dateStr: {
  //           in: dateStrs,
  //         },
  //         accUSDPnl: {
  //           gt: 100,
  //         },
  //         kind: PnlSnapshotKind.MONTH,
  //         contractId: 0,
  //       },
  //       orderBy: [
  //         {
  //           accUSDPnl: 'desc',
  //         },
  //         {
  //           id: 'asc',
  //         },
  //       ],
  //     });

  //   const pnlSnapshotsMap = new Map<string, PnlSnapshot[]>();

  //   pnlRecords.forEach((record) => {
  //     // if (record.contractId === 0) {
  //     //   return;
  //     // }

  //     const key = JSON.stringify({
  //       address: record.address,
  //       contractId: record.contractId,
  //     });

  //     const arr = pnlSnapshotsMap.get(key);

  //     if (arr) {
  //       arr.push(record);
  //     } else {
  //       pnlSnapshotsMap.set(key, [record]);
  //     }
  //   });

  //   const pnlSnapshotsMapKeys = Array.from(pnlSnapshotsMap.keys());

  //   const CHUNK = 35;
  //   const totalResultHistories: TradeHistory[] = [];
  //   const botCountData: Record<string, number> = {};
  //   const totalBots: {
  //     dateStr: string;
  //     contractId: number;
  //     address: string;
  //   }[] = [];

  //   for (let i = 0; i < pnlSnapshotsMapKeys.length; i += CHUNK) {
  //     const chunk = pnlSnapshotsMapKeys.slice(i, i + CHUNK);

  //     const historyRecords = await this.prismaService.tradeHistory.findMany({
  //       where: {
  //         OR: [
  //           ...chunk
  //             .map(
  //               (item) =>
  //                 JSON.parse(item) as { address: string; contractId: number },
  //             )
  //             .map((item) => ({
  //               address: item.address,
  //               ...(item.contractId !== 0
  //                 ? { contractId: item.contractId }
  //                 : { contractId: { in: contracts.map((c) => c.id) } }),
  //             })),
  //         ],
  //       },
  //       orderBy: [
  //         {
  //           date: 'asc',
  //         },
  //         {
  //           block: 'asc',
  //         },
  //         {
  //           id: 'asc',
  //         },
  //       ],
  //     });

  //     const historyRecordsMap = new Map<string, TradeHistory[]>();

  //     historyRecords.forEach((record) => {
  //       const key = record.address;

  //       const arr = historyRecordsMap.get(key);

  //       if (arr) {
  //         arr.push(record);
  //       } else {
  //         historyRecordsMap.set(key, [record]);
  //       }
  //     });

  //     chunk.forEach((key) => {
  //       const item = JSON.parse(key) as { address: string; contractId: number };

  //       const subPnlRecords = pnlSnapshotsMap.get(key) || [];
  //       const allHistories = historyRecordsMap.get(item.address) || [];

  //       const nodes: (PnlSnapshotDevDetails & {
  //         endDate: Date;
  //         ratio: number;
  //       })[] = [];

  //       subPnlRecords.forEach((record) => {
  //         for (let divider = dailyPlans; divider > 0; divider--) {
  //           const allTimeDetails = this.getPnlSnapshotDevDetails(
  //             new Date('2024-01-01'),
  //             new Date(
  //               getStartOfDay(new Date(record.dateStr)).getTime() +
  //                 (24 * 3600 * 1000) / divider,
  //             ),
  //             record,
  //             allHistories,
  //             params,
  //           );

  //           const sumScore = allTimeDetails?.score || 0;

  //           if (sumScore > params.minScore) {
  //             nodes.push({
  //               ...allTimeDetails,
  //               endDate: new Date(
  //                 getStartOfDay(new Date(record.dateStr)).getTime() +
  //                   (24 * 3600 * 1000) / divider,
  //               ),
  //               score: sumScore,
  //               ratio: 1,
  //             });
  //           }
  //         }
  //       });

  //       nodes.forEach((node) => {
  //         const dateStr = node.dateStr;

  //         botCountData[dateStr] = (botCountData[dateStr] || 0) + 1;
  //         totalBots.push({
  //           dateStr: node.dateStr,
  //           contractId: node.contractId,
  //           address: node.address,
  //         });

  //         const startDate = node.endDate;
  //         const endDate = new Date(
  //           startDate.getTime() + (24 * 3600 * 1000) / dailyPlans + 1800 * 1000,
  //         );

  //         const histories = this.getSortedPartialHistories(
  //           node.histories,
  //           startDate,
  //           endDate,
  //         );

  //         const transformedHistories = histories.map((history) => {
  //           return {
  //             ...history,
  //             size: `${Number(history.size) * node.ratio}`,
  //             pnl: `${Number(history.pnl) * node.ratio}`,
  //             collateralDelta: history.collateralDelta
  //               ? `${Number(history.collateralDelta) * node.ratio}`
  //               : null,
  //           };
  //         });

  //         totalResultHistories.push(...transformedHistories);
  //       });
  //     });
  //   }

  //   const accInData: Record<string, number> = {};
  //   const accOutData: Record<string, number> = {};
  //   const accPnlData: Record<string, number> = {};
  //   const accInOutData: Record<string, number> = {};
  //   const taskCountData: Record<string, number> = {};
  //   const positionCountData: Record<string, Record<string, boolean>> = {};
  //   const actionTypeCount: Record<string, number> = {};

  //   const traderCountData: Record<string, Record<string, boolean>> = {};
  //   const uniqueTraders: Record<string, boolean> = {};

  //   let accInOut = 0;
  //   let maxInvested = 0;

  //   let accPnlLoss = 0;
  //   let lossCount = 0;
  //   let accPnlProfit = 0;
  //   let profitCount = 0;
  //   let bottomPnl = 0;
  //   let peakPnl = 0;
  //   let accPnl = 0;
  //   let maxLoss = 0;
  //   let maxProfit = 0;

  //   totalResultHistories
  //     .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  //     .forEach((history) => {
  //       const date = dayjs(history.date).format('YYYY-MM-DD HH:[00]:[00]');
  //       const usdPnl = +history.pnl * +history.collateralPriceUsd;

  //       accPnl += usdPnl;

  //       peakPnl = Math.max(peakPnl, accPnl);
  //       bottomPnl = Math.min(bottomPnl, accPnl);

  //       if (usdPnl < 0) {
  //         accPnlLoss += usdPnl;
  //         maxLoss = Math.min(maxLoss, usdPnl);
  //         lossCount++;
  //       } else if (usdPnl > 0) {
  //         accPnlProfit += usdPnl;
  //         maxProfit = Math.max(maxProfit, usdPnl);
  //         profitCount++;
  //       }

  //       accPnlData[date] = (accPnlData[date] ?? 0) + usdPnl;
  //       taskCountData[date] = (taskCountData[date] ?? 0) + 1;
  //       uniqueTraders[history.address.toLowerCase()] = true;

  //       const positionCountMap = positionCountData[date] ?? {};
  //       positionCountMap[history.tradeIndex] = true;
  //       positionCountData[date] = positionCountMap;

  //       const traderCountMap = traderCountData[date] ?? {};
  //       traderCountMap[history.address.toLowerCase()] = true;
  //       traderCountData[date] = traderCountMap;

  //       actionTypeCount[history.action] =
  //         (actionTypeCount[history.action] ?? 0) + 1;

  //       switch (history.action) {
  //         case TradeActionType.TradeOpenedMarket: {
  //           const inOut = +history.size * +history.collateralPriceUsd;

  //           accInOutData[date] = (accInOutData[date] ?? 0) + -inOut;
  //           accInOut = accInOut + -inOut;

  //           accInData[date] = (accInData[date] ?? 0) + inOut;

  //           break;
  //         }
  //         case TradeActionType.TradeOpenedLimit: {
  //           const inOut = +history.size * +history.collateralPriceUsd;

  //           accInOutData[date] = (accInOutData[date] ?? 0) + -inOut;

  //           accInOut = accInOut + -inOut;

  //           accInData[date] = (accInData[date] ?? 0) + inOut;

  //           break;
  //         }
  //         case TradeActionType.TradeClosedMarket: {
  //           const inOut =
  //             (+history.size + +history.pnl) * +history.collateralPriceUsd;

  //           accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

  //           accInOut = accInOut + inOut;

  //           accOutData[date] = (accOutData[date] ?? 0) + inOut;

  //           break;
  //         }
  //         case TradeActionType.TradeClosedLIQ: {
  //           const inOut =
  //             (+history.size + +history.pnl) * +history.collateralPriceUsd;

  //           accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

  //           accInOut = accInOut + inOut;

  //           accOutData[date] = (accOutData[date] ?? 0) + inOut;

  //           break;
  //         }
  //         case TradeActionType.TradeClosedSL: {
  //           const inOut =
  //             (+history.size + +history.pnl) * +history.collateralPriceUsd;

  //           accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

  //           accInOut = accInOut + inOut;

  //           accOutData[date] = (accOutData[date] ?? 0) + inOut;

  //           break;
  //         }
  //         case TradeActionType.TradeClosedTP: {
  //           const inOut =
  //             (+history.size + +history.pnl) * +history.collateralPriceUsd;

  //           accInOutData[date] = (accInOutData[date] ?? 0) + inOut;

  //           accInOut = accInOut + inOut;

  //           accOutData[date] = (accOutData[date] ?? 0) + inOut;

  //           break;
  //         }
  //         case TradeActionType.TradeLeverageUpdate: {
  //           const delta =
  //             (-(history.collateralDelta || 0) + +history.pnl) *
  //             +history.collateralPriceUsd;

  //           accInOutData[date] = (accInOutData[date] ?? 0) + delta;

  //           accInOut = accInOut + delta;

  //           if (delta > 0) {
  //             accOutData[date] = (accOutData[date] ?? 0) + delta;
  //           } else {
  //             accInData[date] = (accInData[date] ?? 0) + -delta;
  //           }

  //           break;
  //         }
  //         case TradeActionType.TradePosSizeIncrease: {
  //           const delta =
  //             (-(history.collateralDelta || 0) + +history.pnl) *
  //             +history.collateralPriceUsd;

  //           accInOutData[date] = (accInOutData[date] ?? 0) + delta;

  //           accInOut = accInOut + delta;

  //           if (delta > 0) {
  //             accOutData[date] = (accOutData[date] ?? 0) + delta;
  //           } else {
  //             accInData[date] = (accInData[date] ?? 0) + -delta;
  //           }

  //           break;
  //         }
  //         case TradeActionType.TradePosSizeDecrease: {
  //           const delta =
  //             (-(history.collateralDelta || 0) + +history.pnl) *
  //             +history.collateralPriceUsd;

  //           accInOutData[date] = (accInOutData[date] ?? 0) + delta;

  //           accInOut = accInOut + delta;

  //           if (delta > 0) {
  //             accOutData[date] = (accOutData[date] ?? 0) + delta;
  //           } else {
  //             accInData[date] = (accInData[date] ?? 0) + -delta;
  //           }

  //           break;
  //         }
  //       }

  //       maxInvested = Math.min(maxInvested, accInOut);
  //     });

  //   const accPnls: AccPnl[] = Object.entries(accPnlData)
  //     .map(([date, pnl]) => ({
  //       date: dayjs(date).toDate(),
  //       pnl,
  //       in: accInData[date] ?? 0,
  //       out: accOutData[date] ?? 0,
  //       inOut: accInOutData[date] ?? 0,
  //       taskCount: taskCountData[date] ?? 0,
  //       positionCount: Object.keys(positionCountData[date] ?? {}).length,
  //       traderCount: Object.keys(traderCountData[date] ?? {}).length,
  //     }))
  //     .sort((a, b) => a.date.getTime() - b.date.getTime());

  //   const botCounts: BotCount[] = Object.entries(botCountData)
  //     .map(([date, count]) => ({
  //       date: dayjs(date).toDate(),
  //       botCount: count,
  //     }))
  //     .sort((a, b) => a.date.getTime() - b.date.getTime());

  //   return {
  //     accPnls,
  //     botCounts,
  //     histories: totalResultHistories,
  //     maxInvested,
  //     uniqueTraders: Object.keys(uniqueTraders),
  //     actionTypeCount,
  //     maxLoss,
  //     maxProfit,
  //     bottomPnl,
  //     peakPnl,
  //     lossCount,
  //     profitCount,
  //     avgLoss: lossCount > 0 ? accPnlLoss / lossCount : 0,
  //     avgProfit: profitCount > 0 ? accPnlProfit / profitCount : 0,
  //     totalPnls: accPnl,
  //     totalBots,
  //   };
  // }

  async getWholeCompressedHistories(
    platform: Platform,
    startDate: string,
    params: ExportFilter[],
  ) {
    if (this.cachedDateStr === startDate && this.cache) {
      return this.cache;
    }

    console.time('getWholeCompressedHistories==============>');

    const dayGaps = dayjs().diff(dayjs(startDate), 'day') + 2;

    const { accPnls, uniqueTraders, botCounts, maxInvested, totalBots } =
      await this.getRangeHistories(platform, startDate, dayGaps, params);

    console.timeEnd('getWholeCompressedHistories==============>');

    this.cache = {
      accPnls,
      botCounts,
      maxInvested,
      uniqueTraders,
      totalBots,
    };
    this.cachedDateStr = startDate;

    return {
      accPnls,
      botCounts,
      maxInvested,
      uniqueTraders,
      totalBots,
    };
  }

  // private getPnlData(
  //   items: { pnl: number; date: Date }[],
  //   scales: string[],
  //   dateFormat: string,
  // ): {
  //   data: { value: number; label: string }[];
  //   accData: { value: number; label: string }[];
  // } {
  //   const dailyPnlData: Record<string, number> = {};

  //   items.forEach((history) => {
  //     const date = dayjs(history.date).format(dateFormat);
  //     dailyPnlData[date] = (dailyPnlData[date] ?? 0) + +history.pnl;
  //   });

  //   const data: { value: number; label: string }[] = [];
  //   const accData: { value: number; label: string }[] = [];
  //   let accPnl = 0;

  //   for (const scale of scales) {
  //     const pnl = dailyPnlData[scale] ?? 0;
  //     accPnl += pnl;

  //     data.push({
  //       value: pnl,
  //       label: scale,
  //     });

  //     accData.push({
  //       value: accPnl,
  //       label: scale,
  //     });
  //   }

  //   return {
  //     data,
  //     accData,
  //   };
  // }

  // async getTestingReport(first: number, after: number | null) {
  //   const records: TestingReport[] = after
  //     ? await this.prismaService.testingReport.findMany({
  //         skip: after ? 1 : undefined,
  //         take: first,
  //         cursor: {
  //           id: after,
  //         },
  //       })
  //     : await this.prismaService.testingReport.findMany({
  //         take: first,
  //       });

  //   const edges: TestingReportEdge[] = records.map((record) => ({
  //     cursor: record.id,
  //     node: record,
  //   }));

  //   return {
  //     edges,
  //     pageInfo: {
  //       hasNextPage: edges.length > 0,
  //       endCursor: edges.length > 0 ? edges[edges.length - 1].cursor : null,
  //     },
  //   };
  // }

  // async getStatisticData(): Promise<StatisticData[]> {
  //   const records = await this.prismaService.testingReport.findMany();

  //   return records.map((record) => {
  //     let sumOfLost = 0;
  //     let countOfLost = 0;
  //     let sumOfWin = 0;
  //     let countOfWin = 0;

  //     for (const pnl of record.usdPnls) {
  //       if (pnl < 0) {
  //         sumOfLost += pnl;
  //         countOfLost++;
  //       } else if (pnl > 0) {
  //         sumOfWin += pnl;
  //         countOfWin++;
  //       }
  //     }

  //     return {
  //       sumOfLost,
  //       countOfLost,
  //       sumOfWin,
  //       countOfWin,
  //       size: record.maxCount,
  //     };
  //   });
  // }

  // private async handleSingleCase(
  //   startDate: string,
  //   dayGaps: number,
  //   params: ExportFilter,
  // ) {
  //   console.time(
  //     `${params.window}-${params.minR2}-${params.n}-${params.m}-${params.minScore}`,
  //   );

  //   try {
  //     const {
  //       accPnls,
  //       maxInvested,
  //       uniqueTraders,
  //       maxLoss,
  //       lossCount,
  //       profitCount,
  //       avgLoss,
  //       avgProfit,
  //       peakPnl,
  //       bottomPnl,
  //       maxProfit,
  //       totalPnls,
  //     } = await this.getRangeHistoriesForRecord(
  //       startDate,
  //       dayGaps,
  //       params,
  //       false,
  //     );

  //     const investedUSD = maxInvested;

  //     const startTimestamp = new Date(startDate).getTime();
  //     const endTimestamp =
  //       new Date(startDate).getTime() + dayGaps * 1000 * 60 * 60 * 24;

  //     const dailyScales: string[] = [];

  //     for (let i = startTimestamp; i < endTimestamp; i += 1000 * 60 * 60 * 24) {
  //       dailyScales.push(dayjs(i).format('YYYY-MM-DD'));
  //     }

  //     const { data: pnlData, accData: accPnlData } = this.getPnlData(
  //       accPnls,
  //       dailyScales,
  //       'YYYY-MM-DD',
  //     );

  //     const { data: dailyTaskCountChartData } = this.getPnlData(
  //       accPnls.map((item) => ({
  //         pnl: item.taskCount,
  //         date: item.date,
  //       })),
  //       dailyScales,
  //       'YYYY-MM-DD',
  //     );

  //     const { data: dailyPositionCountChartData } = this.getPnlData(
  //       accPnls.map((item) => ({
  //         pnl: item.positionCount,
  //         date: item.date,
  //       })),
  //       dailyScales,
  //       'YYYY-MM-DD',
  //     );

  //     const { data: dailyTraderCountChartData } = this.getPnlData(
  //       accPnls.map((item) => ({
  //         pnl: item.traderCount,
  //         date: item.date,
  //       })),
  //       dailyScales,
  //       'YYYY-MM-DD',
  //     );

  //     const totalTasks = Object.values(dailyTaskCountChartData).reduce(
  //       (acc, item) => acc + item.value,
  //       0,
  //     );
  //     const totalPositions = Object.values(dailyPositionCountChartData).reduce(
  //       (acc, item) => acc + item.value,
  //       0,
  //     );
  //     const totalTraders = Object.values(dailyTraderCountChartData).reduce(
  //       (acc, item) => acc + item.value,
  //       0,
  //     );

  //     const usdArr: number[] = accPnlData.map((item) => item.value);
  //     const xs: number[] = [];

  //     accPnlData.forEach((_item, index) => xs.push(index));

  //     const regression = new SimpleLinearRegression(xs, usdArr);
  //     const score = regression.score(xs, usdArr);

  //     await this.prismaService.testingReport.create({
  //       data: {
  //         window: params.window,
  //         minR2: params.minR2,
  //         minAvgSize: params.minAvgSize,
  //         maxAvgSize: params.maxAvgSize,
  //         minCount: params.minCount,
  //         maxCount: params.maxCount,
  //         weekWeight: 0,
  //         monthWeight: 0,
  //         threeMonthWeight: 0,
  //         allTimeWeight: 1,
  //         n: params.n,
  //         m: params.m,
  //         minScore: params.minScore,
  //         investedUSD,
  //         totalUSDPnl: totalPnls,
  //         totalTasks,
  //         totalPositions,
  //         totalTraders,
  //         totalUniqueTraders: uniqueTraders.length,
  //         usdPnls: pnlData.map((item) => item.value),
  //         calculatedR2: Number.isNaN(score.r2) ? 1 : score.r2,
  //         calculatedSlope: regression.slope,
  //         maxLoss,
  //         lossCount,
  //         avgLoss,
  //         maxProfit,
  //         profitCount,
  //         avgProfit,
  //         peakAccProfit: peakPnl,
  //         bottomAccProfit: bottomPnl,
  //       },
  //     });

  //     console.timeEnd(
  //       `${params.window}-${params.minR2}-${params.n}-${params.m}-${params.minScore}`,
  //     );
  //   } catch (error) {
  //     console.error(error);
  //   }
  // }

  // async autoTesting(): Promise<boolean> {
  //   const startDates = ['2025-01-01'];

  //   const minR2Scales = [0.93];
  //   const windowScales = [6];
  //   const penaltyScales = [1];
  //   const sizeScales = [0, 300, 2000, 5000, 10000, 30000, 100000, 1000000000];
  //   const countScales = [
  //     10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120, 140, 160,
  //     180, 200, 240, 280, 320, 360, 400, 450, 500, 550, 600, 700, 800, 900,
  //     1000, 1000_000_000,
  //   ];

  //   await this.prismaService.testingReport.deleteMany();

  //   for (const window of windowScales) {
  //     for (const penalty of penaltyScales) {
  //       for (let count = 10; count < 1000; count += 5) {
  //         for (const startDate of startDates) {
  //           const dayGaps = dayjs(new Date()).diff(dayjs(startDate), 'day');

  //           await this.handleSingleCase(startDate, dayGaps, {
  //             window,
  //             minR2: 0.93,
  //             n: 2,
  //             m: penalty,
  //             minScore: 10,
  //             minAvgSize: 2500,
  //             maxAvgSize: 50000,
  //             minCount: count,
  //             maxCount: count + 5,
  //             ratio: 1,
  //           });
  //         }

  //         this.logger.nativeLog({
  //           severity: 'Info',
  //           summary: `Done count ${count} - ${count + 5}`,
  //         });
  //       }
  //     }

  //     this.logger.nativeLog({
  //       severity: 'Info',
  //       summary: `Done window ${window}`,
  //     });
  //   }

  //   this.logger.nativeLog({
  //     severity: 'Info',
  //     summary: 'Finished',
  //   });

  //   return true;
  // }
}

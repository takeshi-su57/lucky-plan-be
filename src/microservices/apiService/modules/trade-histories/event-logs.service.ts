import { Injectable } from '@nestjs/common';
import { Platform } from 'generated/prisma/client';

import { CreatePerpTradingEventLogInput } from './dto/event-logs.input';

import { PrismaService } from 'src/global/prisma.service';
import {
  PerpTradeHistory,
  PerpTradeHistoryOperation,
  PerpTradePosition,
  PerpTradePositionsWithSummary,
} from './entities/event-logs.entity';
import { Contract } from '../contracts/entities/contract.entity';
import { getWeb3Info } from 'src/web3/utils';
import {
  getEventLogOrderBy,
  getEventLogStableId,
} from './event-log-identity.utils';

@Injectable()
export class EventLogsService {
  constructor(private prismaService: PrismaService) {}

  async createManyPerpTradingEventLogs(
    inputs: CreatePerpTradingEventLogInput[],
  ) {
    if (inputs.length === 0) {
      return [];
    }

    return await this.prismaService.perpTradingEventLog.createManyAndReturn({
      data: inputs.map((input) => ({
        ...input,
      })),
      skipDuplicates: true,
    });
  }

  async getPerpTradePositionsWithSummary(
    address: string,
    platform: Platform,
    maxLeverage: number | null,
    startedAt: Date | null,
    stoppedAt: Date | null,
    endedAt: Date | null,
  ): Promise<PerpTradePositionsWithSummary> {
    const allContractsMap: Record<string, Contract> = {};

    const allContracts = await this.prismaService.contract.findMany();

    allContracts.forEach((contract) => {
      allContractsMap[contract.id] = contract;
    });

    const records = await this.prismaService.perpTradingEventLog.findMany({
      where: {
        address: address.toLowerCase(),
        platform,
        ...(startedAt || endedAt
          ? {
              date: {
                ...(startedAt ? { gte: startedAt } : {}),
                ...(endedAt ? { lte: endedAt } : {}),
              },
            }
          : {}),
      },
      orderBy: getEventLogOrderBy(),
    });

    return this.convertToPerpTradePositionsWithSummary(
      platform,
      records
        .map((record) => {
          const contract = allContractsMap[record.contractId];

          const history = getWeb3Info(
            contract.platform,
            contract.version,
          ).eventToPerpTradeHistory(
            contract.chainId,
            JSON.parse(record.jsonLog) as any,
          );

          return history
            ? {
                ...history,
                id: getEventLogStableId(record),
                date: record.date,
                chainId: contract.chainId,
                contractId: record.contractId,
                platform: record.platform,
              }
            : null;
        })
        .filter((item) => !!item),
      {
        stoppedAt: stoppedAt || undefined,
        maxLeverage: maxLeverage || undefined,
      },
    );
  }

  convertToPerpTradePositionsWithSummary(
    platform: Platform,
    histories: PerpTradeHistory[],
    filters: {
      stoppedAt?: Date;
      minCollateral?: number;
      maxCollateral?: number;
      minLeverage?: number;
      maxLeverage?: number;
      collateralRanges?: Array<{ min: number; max: number }>;
      sizeRanges?: Array<{ min: number; max: number }>;
      leverageRanges?: Array<{ min: number; max: number }>;
    },
  ): PerpTradePositionsWithSummary {
    const sortedHistories = [...histories]
      .filter((history) => history.platform === platform)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let openedPositions = 0;
    let totalDuration = 0;
    let maxDuration = 0;
    let totalPositions = 0;
    let sumOfLeverages = 0;
    const sumOfPnl = {
      total: 0,
      positive: 0,
      negative: 0,
      positiveCount: 0,
      negativeCount: 0,
    };
    let sumOfSize = 0;
    let sumOfCollaterals = 0;

    const missionHistories: PerpTradePosition[] = [];

    const groupedByPositionKey = new Map<string, PerpTradeHistory[]>();

    sortedHistories.forEach((history) => {
      if (!history) {
        return;
      }

      const positionKey = `${history.chainId}:${history.positionKey}`;

      const arr = groupedByPositionKey.get(positionKey);

      if (arr) {
        arr.push(history);
      } else {
        groupedByPositionKey.set(positionKey, [history]);
      }
    });

    for (const histories of Array.from(groupedByPositionKey.values())) {
      for (let i = 0; i < histories.length; i++) {
        const history = histories[i];

        if (history.operation !== PerpTradeHistoryOperation.OPEN) {
          continue;
        }

        if (filters.stoppedAt && history.date >= filters.stoppedAt) {
          continue;
        }

        if (
          filters.collateralRanges &&
          !filters.collateralRanges.some(
            (range) =>
              history.collateralInUsd >= range.min &&
              history.collateralInUsd <= range.max,
          )
        ) {
          continue;
        }

        if (
          filters.sizeRanges &&
          !filters.sizeRanges.some(
            (range) =>
              history.sizeInUsd >= range.min && history.sizeInUsd <= range.max,
          )
        ) {
          continue;
        }

        if (
          filters.leverageRanges &&
          !filters.leverageRanges.some(
            (range) =>
              history.leverage >= range.min && history.leverage <= range.max,
          )
        ) {
          continue;
        }

        if (
          filters.minCollateral !== undefined &&
          history.collateralInUsd < filters.minCollateral
        ) {
          continue;
        }

        if (
          filters.maxCollateral !== undefined &&
          history.collateralInUsd > filters.maxCollateral
        ) {
          continue;
        }

        if (
          filters.minLeverage !== undefined &&
          history.leverage < filters.minLeverage
        ) {
          continue;
        }

        if (filters.maxLeverage && history.leverage > filters.maxLeverage) {
          continue;
        }

        if (
          filters.maxLeverage &&
          history.pair.toLowerCase().includes('degen')
        ) {
          continue;
        }

        openedPositions++;

        totalPositions++;

        let maxSizeIn = 0;
        let maxCollaterals = 0;
        let maxLeverages = 0;
        let tempPnl = 0;
        let prevCollateralUsdPrice = history.collateralUsdPrice;

        const tempHistories: PerpTradeHistory[] = [];

        for (let j = i; j < histories.length; j++) {
          const nextHistory = histories[j];

          if (
            j > i &&
            nextHistory.operation === PerpTradeHistoryOperation.OPEN
          ) {
            break;
          }

          if (
            platform === Platform.GNS &&
            (nextHistory.operation ===
              PerpTradeHistoryOperation.INCREASE_LEVERAGE ||
              nextHistory.operation ===
                PerpTradeHistoryOperation.DECREASE_LEVERAGE ||
              nextHistory.operation === PerpTradeHistoryOperation.PNL_WITHDRAW)
          ) {
            nextHistory.collateralUsdPrice = prevCollateralUsdPrice;
          } else {
            prevCollateralUsdPrice = nextHistory.collateralUsdPrice;
          }

          if (
            platform === Platform.GNS &&
            nextHistory.operation === PerpTradeHistoryOperation.PNL_WITHDRAW
          ) {
            tempPnl += +nextHistory.usdPnl * nextHistory.collateralUsdPrice;
          } else {
            tempPnl += +nextHistory.usdPnl;
          }

          maxSizeIn = Math.max(maxSizeIn, +nextHistory.sizeInUsd);
          maxCollaterals = Math.max(
            maxCollaterals,
            +nextHistory.collateralInUsd,
          );
          maxLeverages = Math.max(maxLeverages, +nextHistory.leverage);

          tempHistories.push(nextHistory);

          if (nextHistory.operation === PerpTradeHistoryOperation.CLOSE) {
            const gap =
              new Date(histories[j].date).getTime() -
              new Date(histories[i].date).getTime();

            totalDuration += gap;

            openedPositions--;
            maxDuration = Math.max(maxDuration, gap);

            break;
          }
        }

        sumOfSize += maxSizeIn;
        sumOfCollaterals += maxCollaterals;
        sumOfPnl.total += tempPnl;
        sumOfLeverages += maxLeverages;

        if (tempPnl > 0) {
          sumOfPnl.positive += tempPnl;
          sumOfPnl.positiveCount++;
        } else {
          sumOfPnl.negative += tempPnl;
          sumOfPnl.negativeCount++;
        }

        missionHistories.push({
          histories: tempHistories,
        });
      }
    }

    return {
      positions: missionHistories.sort((a, b) => {
        if (a.histories.length === 0 || b.histories.length === 0) {
          return a.histories.length - b.histories.length;
        }

        return (
          new Date(a.histories[0].date).getTime() -
          new Date(b.histories[0].date).getTime()
        );
      }),
      openedPositions,
      totalPnl: sumOfPnl.total,
      totalPositions,
      avgDuration: totalPositions > 0 ? totalDuration / totalPositions : 0,
      maxDuration,
      avgPnl: totalPositions > 0 ? sumOfPnl.total / totalPositions : 0,
      avgPositivePnl:
        sumOfPnl.positiveCount > 0
          ? sumOfPnl.positive / sumOfPnl.positiveCount
          : 0,
      avgNegativePnl:
        sumOfPnl.negativeCount > 0
          ? sumOfPnl.negative / sumOfPnl.negativeCount
          : 0,
      avgSize: totalPositions > 0 ? sumOfSize / totalPositions : 0,
      avgCollateral: totalPositions > 0 ? sumOfCollaterals / totalPositions : 0,
      avgPnlPercentageBySize:
        sumOfSize > 0 ? (sumOfPnl.total / sumOfSize) * 100 : 1000_000_000,
      avgPnlPercentageByCollateral:
        sumOfCollaterals > 0
          ? (sumOfPnl.total / sumOfCollaterals) * 100
          : 1000_000_000,
      avgLeverage: sumOfLeverages > 0 ? sumOfLeverages / totalPositions : 0,
    };
  }
}

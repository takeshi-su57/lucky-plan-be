import { Injectable } from '@nestjs/common';
import { TradeActionType } from '@prisma/client';
import * as csv from 'csv-parser';
import * as fs from 'fs';
import * as path from 'path';

import { ActionItem } from 'src/microservices/apiService/modules/actions/entities/action.entity';
import {
  CreateTradeHistoryInput,
  GetUserTransactionCountsInput,
} from './dto/trade-history.input';

import { positionSizeIncreaseExecutedEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/position-size-decrease-executed.parser';
import { leverageUpdateExecutedEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/leverage-update-executed.parser';
import { marketExecutedEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/market-executed.parser';
import { limitExecutedEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/limit-executed.parser';
import { tradePositivePnlWithdrawnEventParser } from 'src/microservices/web3Service/platform/gns/v10/eventParsers/trade-positive-pnl-withdrawn.parser';

import {
  CancelReason,
  PendingOrderType,
} from 'src/microservices/web3Service/platform/gns/v10/types';

import { getStartOfMonth, getStartOfWeek } from 'src/utils';
import { getStartOfDay } from 'src/utils';
import { TradeTransactionCount } from './entities/trade-history.entity';

import {
  eventParsers,
  eventToActionParser,
} from 'src/microservices/web3Service/platform/gns/v10/eventParsers';

import { PrismaService } from 'src/global/prisma.service';
import { GnsService } from 'src/global/gns.service';

@Injectable()
export class TradeHistoriesService {
  readonly registeredEventNames: string[] = [];

  constructor(
    private prismaService: PrismaService,
    private gnsService: GnsService,
  ) {
    this.registeredEventNames = eventParsers.map((item) => item.eventName);

    // setTimeout(() => {
    //   this.migrateTradeHistoriesFromCsv('2024-10-01', '2025-06-22');
    // }, 60_000);
  }

  async createMany(inputs: CreateTradeHistoryInput[]) {
    if (inputs.length === 0) {
      return [];
    }

    return await this.prismaService.tradeHistory.createManyAndReturn({
      data: inputs.map((input) => ({
        ...input,
      })),
    });
  }

  async getTradeTransactionCounts(
    contractIds: number[],
    addresses: string[],
  ): Promise<TradeTransactionCount> {
    const now = new Date();

    const result = {
      daily: 0,
      weekly: 0,
      monthly: 0,
    };

    for (const contractId of contractIds) {
      const dailyFilter = {
        ...(addresses.length > 0
          ? {
              address: {
                in: addresses.map((address) => address.toLowerCase()),
              },
            }
          : {}),
        contractId,
        date: {
          gte: getStartOfDay(now),
        },
      };

      const weeklyFilter = {
        ...(addresses.length > 0
          ? {
              address: {
                in: addresses.map((address) => address.toLowerCase()),
              },
            }
          : {}),
        contractId,
        date: {
          gte: getStartOfWeek(now),
        },
      };

      const monthlyFilter = {
        ...(addresses.length > 0
          ? {
              address: {
                in: addresses.map((address) => address.toLowerCase()),
              },
            }
          : {}),
        contractId,
        date: {
          gte: getStartOfMonth(now),
        },
      };

      const counts = await this.prismaService.$transaction([
        this.prismaService.tradeHistory.count({
          where: dailyFilter,
        }),
        this.prismaService.tradeHistory.count({
          where: weeklyFilter,
        }),
        this.prismaService.tradeHistory.count({
          where: monthlyFilter,
        }),
      ]);

      result.daily += counts[0];
      result.weekly += counts[1];
      result.monthly += counts[2];
    }

    return result;
  }

  async getUserTransactionCounts(
    inputs: GetUserTransactionCountsInput[],
  ): Promise<TradeTransactionCount[]> {
    const now = new Date();

    const startOfDay = getStartOfDay(now);
    const startOfWeek = getStartOfWeek(now);
    const startOfMonth = getStartOfMonth(now);

    const result: TradeTransactionCount[] = [];

    for (const input of inputs) {
      const { address, contractId, startedAt, endedAt } = input;

      const startedAtDate = startedAt ? new Date(startedAt) : startOfDay;
      const endedAtDate = endedAt ? new Date(endedAt) : now;

      const dailyFilter = {
        address: address.toLowerCase(),
        contractId,
        date: {
          gte: startedAtDate
            ? startOfDay > startedAtDate
              ? startOfDay
              : startedAtDate
            : startOfDay,
          lte: endedAtDate ? endedAtDate : now,
        },
      };

      const weeklyFilter = {
        address: address.toLowerCase(),
        contractId,
        date: {
          gte: startedAtDate
            ? startOfWeek > startedAtDate
              ? startOfWeek
              : startedAtDate
            : startOfWeek,
          lte: endedAtDate ? endedAtDate : now,
        },
      };

      const monthlyFilter = {
        address: address.toLowerCase(),
        contractId,
        date: {
          gte: startedAtDate
            ? startOfMonth > startedAtDate
              ? startOfMonth
              : startedAtDate
            : startOfMonth,
          lte: endedAtDate ? endedAtDate : now,
        },
      };

      const counts = await this.prismaService.$transaction([
        this.prismaService.tradeHistory.count({
          where: dailyFilter,
        }),
        this.prismaService.tradeHistory.count({
          where: weeklyFilter,
        }),
        this.prismaService.tradeHistory.count({
          where: monthlyFilter,
        }),
      ]);

      result.push({
        daily: counts[0],
        weekly: counts[1],
        monthly: counts[2],
      });
    }

    return result;
  }

  getTradeHistories(addresses: string[], contractId: number) {
    return this.prismaService.tradeHistory.findMany({
      where: {
        address: {
          in: addresses.map((address) => address.toLowerCase()),
        },
        ...(contractId === 0 ? { contractId: { not: 4 } } : { contractId }),
      },
    });
  }

  async migrateTradeHistoriesFromCsv(fromDateStr: string, toDateStr: string) {
    const BATCH_SIZE = 10000;

    const fromDate = new Date(fromDateStr);
    const toDate = new Date(toDateStr);

    console.time('Delete trade histories');

    await this.prismaService.tradeHistory.deleteMany({
      where: {
        date: {
          gte: fromDate,
          lte: toDate,
        },
      },
    });

    console.timeEnd('Delete trade histories');

    const dirName = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '_EventLog__202506221924.csv',
    );

    const cache: Record<
      number,
      { item: ActionItem; blockNumber: number; timestamp: Date }[]
    > = {};

    console.time('migrateTradeHistoriesFromCsv');

    fs.createReadStream(dirName)
      .pipe(csv())
      .on('data', (row) => {
        const rowDate = new Date(row.date);

        if (rowDate < fromDate || rowDate > toDate) {
          return;
        }

        const event = JSON.parse(row.jsonLog);

        if (!this.registeredEventNames.includes(event.eventName)) {
          return;
        }

        const cacheByContractId = cache[Number(row.contractId)];

        if (!cacheByContractId) {
          cache[Number(row.contractId)] = [];
        }

        cache[Number(row.contractId)].push({
          item: eventToActionParser(Number(row.contractId), event),
          blockNumber: Number(row.block),
          timestamp: rowDate,
        });

        if (cache[Number(row.contractId)].length === BATCH_SIZE) {
          console.log('handleActionItems', {
            contractId: Number(row.contractId),
            length: cache[Number(row.contractId)].length,
            from: cache[Number(row.contractId)][0].blockNumber,
            to: cache[Number(row.contractId)][
              cache[Number(row.contractId)].length - 1
            ].blockNumber,
          });

          this.handleActionItems(Number(row.contractId), [
            ...cache[Number(row.contractId)],
          ]).then(() =>
            console.log('handleActionItemsEnded', {
              contractId: Number(row.contractId),
              length: cache[Number(row.contractId)].length,
              from: cache[Number(row.contractId)][0].blockNumber,
              to: cache[Number(row.contractId)][
                cache[Number(row.contractId)].length - 1
              ].blockNumber,
            }),
          );

          cache[Number(row.contractId)] = [];
        }
      })
      .on('end', async () => {
        for (const contractId in cache) {
          await this.handleActionItems(Number(contractId), [
            ...cache[Number(contractId)],
          ]);
        }

        console.timeEnd('migrateTradeHistoriesFromCsv');
      });
  }

  // async handleActionItemsV9(
  //   contractId: number,
  //   actionItems: { item: ActionItem; blockNumber: number; timestamp: Date }[],
  // ) {
  //   const historyInputs = actionItems
  //     .map((actionItem) => {
  //       switch (actionItem.item.name) {
  //         case positionSizeIncreaseExecutedEventParser.eventName: {
  //           const { args } =
  //             positionSizeIncreaseExecutedEventParser.actionParser(
  //               actionItem.item,
  //             );

  //           if (args.cancelReason !== CancelReason.NONE) {
  //             return null;
  //           }

  //           const collateral = this.gnsV9Service.getCollateral(
  //             contractId,
  //             args.collateralIndex,
  //           );

  //           const leverage = Number(args.values.newLeverage) / 1000;

  //           return {
  //             date: actionItem.timestamp,
  //             pair: this.gnsV9Service.getPairName(
  //               contractId,
  //               Number(args.pairIndex),
  //             ),
  //             block: actionItem.blockNumber,
  //             address: actionItem.item.position.address.toLowerCase(),
  //             action: TradeActionType.TradePosSizeIncrease,
  //             contractId,
  //             price: `${Number(args.values.newOpenPrice) / 1e10}`,
  //             collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
  //             long: Number(args.long),
  //             size: `${Number(
  //               Number(args.values.newCollateralAmount) /
  //                 Number(collateral.precision),
  //             )}`,
  //             leverage,
  //             pnl: `${-Number(
  //               Number(args.values.borrowingFeeCollateral) /
  //                 Number(collateral.precision),
  //             )}`,
  //             tradeId: null,
  //             collateralIndex: Number(args.collateralIndex),
  //             tradeIndex: Number(args.index),
  //             collateralDelta: `${
  //               Number(args.collateralDelta) / Number(collateral.precision)
  //             }`,
  //             leverageDelta: Number(args.leverageDelta) / 1e3,
  //             marketPrice: `${Number(args.oraclePrice) / 1e10}`,
  //           } as CreateTradeHistoryInput;
  //         }
  //         case positionSizeDecreaseExecutedEventParser.eventName: {
  //           const { args } =
  //             positionSizeDecreaseExecutedEventParser.actionParser(
  //               actionItem.item,
  //             );

  //           if (args.cancelReason !== CancelReason.NONE) {
  //             return null;
  //           }

  //           const collateral = this.gnsV9Service.getCollateral(
  //             contractId,
  //             args.collateralIndex,
  //           );

  //           return {
  //             date: actionItem.timestamp,
  //             pair: this.gnsV9Service.getPairName(
  //               contractId,
  //               Number(args.pairIndex),
  //             ),
  //             block: actionItem.blockNumber,
  //             address: actionItem.item.position.address.toLowerCase(),
  //             action: TradeActionType.TradePosSizeDecrease,
  //             contractId,
  //             price: `${Number(args.values.priceAfterImpact) / 1e10}`,
  //             collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
  //             long: Number(args.long),
  //             size: `${Number(
  //               Number(args.values.newCollateralAmount) /
  //                 Number(collateral.precision),
  //             )}`,
  //             leverage: Number(args.values.newLeverage) / 1e3,
  //             pnl: `${Number(
  //               (Number(args.values.collateralSentToTrader) -
  //                 Number(args.collateralDelta)) /
  //                 Number(collateral.precision),
  //             )}`,
  //             tradeId: null,
  //             collateralIndex: Number(args.collateralIndex),
  //             tradeIndex: Number(args.index),
  //             collateralDelta: `${
  //               -Number(args.collateralDelta) / Number(collateral.precision)
  //             }`,
  //             leverageDelta: Number(args.leverageDelta) / 1e3,
  //             marketPrice: `${Number(args.oraclePrice) / 1e10}`,
  //           } as CreateTradeHistoryInput;
  //         }
  //         case leverageUpdateExecutedEventParser.eventName: {
  //           const { args } = leverageUpdateExecutedEventParser.actionParser(
  //             actionItem.item,
  //           );

  //           if (args.cancelReason !== CancelReason.NONE) {
  //             return null;
  //           }

  //           const collateral = this.gnsV9Service.getCollateral(
  //             contractId,
  //             args.collateralIndex,
  //           );

  //           return {
  //             date: actionItem.timestamp,
  //             pair: this.gnsV9Service.getPairName(
  //               contractId,
  //               Number(args.pairIndex),
  //             ),
  //             block: actionItem.blockNumber,
  //             address: actionItem.item.position.address.toLowerCase(),
  //             action: TradeActionType.TradeLeverageUpdate,
  //             contractId,
  //             price: `${Number(args.oraclePrice) / 1e10}`,
  //             collateralPriceUsd: '0',
  //             long: 0,
  //             size: `${Number(
  //               Number(args.values.newCollateralAmount) /
  //                 Number(collateral.precision),
  //             )}`,
  //             leverage: Number(args.values.newLeverage) / 1e3,
  //             pnl: '0',
  //             tradeId: null,
  //             collateralIndex: Number(args.collateralIndex),
  //             tradeIndex: Number(args.index),
  //             collateralDelta: `${
  //               ((args.isIncrease ? 1 : -1) * Number(args.collateralDelta)) /
  //               Number(collateral.precision)
  //             }`,
  //             leverageDelta: null,
  //             marketPrice: null,
  //           } as CreateTradeHistoryInput;
  //         }
  //         case marketExecutedEventParser.eventName: {
  //           const { args } = marketExecutedEventParser.actionParser(
  //             actionItem.item,
  //           );

  //           const collateral = this.gnsV9Service.getCollateral(
  //             contractId,
  //             args.t.collateralIndex,
  //           );

  //           const pnl = args.open
  //             ? '0'
  //             : `${Number(
  //                 (Number(args.amountSentToTrader) -
  //                   Number(args.t.collateralAmount)) /
  //                   Number(collateral.precision),
  //               )}`;

  //           return {
  //             date: actionItem.timestamp,
  //             pair: this.gnsV9Service.getPairName(
  //               contractId,
  //               Number(args.t.pairIndex),
  //             ),
  //             block: actionItem.blockNumber,
  //             address: actionItem.item.position.address.toLowerCase(),
  //             action: args.open
  //               ? TradeActionType.TradeOpenedMarket
  //               : TradeActionType.TradeClosedMarket,
  //             contractId,
  //             price: `${Number(args.oraclePrice) / 1e10}`,
  //             collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
  //             long: Number(args.t.long),
  //             size: `${Number(
  //               Number(args.t.collateralAmount) / Number(collateral.precision),
  //             )}`,
  //             leverage: Number(args.t.leverage) / 1e3,
  //             pnl: pnl,
  //             tradeId: null,
  //             collateralIndex: Number(args.t.collateralIndex),
  //             tradeIndex: Number(args.t.index),
  //             collateralDelta: null,
  //             leverageDelta: null,
  //             marketPrice: `${Number(args.marketPrice) / 1e10}`,
  //           } as CreateTradeHistoryInput;
  //         }
  //         case limitExecutedEventParser.eventName: {
  //           const { args } = limitExecutedEventParser.actionParser(
  //             actionItem.item,
  //           );

  //           const collateral = this.gnsV9Service.getCollateral(
  //             contractId,
  //             args.t.collateralIndex,
  //           );

  //           const actionNameMap: Record<string, string> = {
  //             [PendingOrderType.LIMIT_OPEN]: TradeActionType.TradeOpenedLimit,
  //             [PendingOrderType.LIQ_CLOSE]: TradeActionType.TradeClosedLIQ,
  //             [PendingOrderType.SL_CLOSE]: TradeActionType.TradeClosedSL,
  //             [PendingOrderType.TP_CLOSE]: TradeActionType.TradeClosedTP,
  //           };

  //           if (!actionNameMap[args.orderType]) {
  //             return null;
  //           }

  //           const pnl =
  //             args.orderType === PendingOrderType.LIMIT_OPEN
  //               ? '0'
  //               : `${Number(
  //                   (Number(args.amountSentToTrader) -
  //                     Number(args.t.collateralAmount)) /
  //                     Number(collateral.precision),
  //                 )}`;

  //           return {
  //             date: actionItem.timestamp,
  //             pair: this.gnsV9Service.getPairName(
  //               contractId,
  //               Number(args.t.pairIndex),
  //             ),
  //             block: actionItem.blockNumber,
  //             address: actionItem.item.position.address.toLowerCase(),
  //             action: actionNameMap[args.orderType],
  //             contractId,
  //             price: `${Number(args.oraclePrice) / 1e10}`,
  //             collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
  //             long: Number(args.t.long),
  //             size: `${Number(
  //               Number(args.t.collateralAmount) / Number(collateral.precision),
  //             )}`,
  //             leverage: Number(args.t.leverage) / 1e3,
  //             pnl: pnl,
  //             tradeId: null,
  //             collateralIndex: Number(args.t.collateralIndex),
  //             tradeIndex: Number(args.t.index),
  //             collateralDelta: null,
  //             leverageDelta: null,
  //             marketPrice: `${Number(args.marketPrice) / 1e10}`,
  //           } as CreateTradeHistoryInput;
  //         }
  //         default: {
  //           return null;
  //         }
  //       }
  //     })
  //     .filter((item): item is CreateTradeHistoryInput => !!item);

  //   await this.createMany(historyInputs);
  // }

  async handleActionItems(
    contractId: number,
    actionItems: { item: ActionItem; blockNumber: number; timestamp: Date }[],
  ) {
    const historyInputs = actionItems
      .map((actionItem) => {
        switch (actionItem.item.name) {
          case positionSizeIncreaseExecutedEventParser.eventName: {
            const { args } =
              positionSizeIncreaseExecutedEventParser.actionParser(
                actionItem.item,
              );

            if (args.cancelReason !== CancelReason.NONE) {
              return null;
            }

            const collateral = this.gnsService.getCollateral(
              contractId,
              args.collateralIndex,
            );

            const leverage = Number(args.values.newLeverage) / 1000;

            return {
              date: actionItem.timestamp,
              pair: this.gnsService.getPairName(
                contractId,
                Number(args.pairIndex),
              ),
              block: actionItem.blockNumber,
              address: actionItem.item.position.address.toLowerCase(),
              action: TradeActionType.TradePosSizeIncrease,
              contractId,
              price: `${Number(args.values.newOpenPrice) / 1e10}`,
              collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
              long: Number(args.long),
              size: `${Number(
                Number(args.values.newCollateralAmount) /
                  Number(collateral.precision),
              )}`,
              leverage,
              pnl: `${Number(
                Number(args.values.existingPnlCollateral) /
                  Number(collateral.precision),
              )}`,
              tradeId: null,
              collateralIndex: Number(args.collateralIndex),
              tradeIndex: Number(args.index),
              collateralDelta: `${
                Number(args.collateralDelta) / Number(collateral.precision)
              }`,
              leverageDelta: Number(args.leverageDelta) / 1e3,
              marketPrice: `${Number(args.values.priceImpact.priceAfterImpact) / 1e10}`,
              isCounterTrade: args.values.isCounterTradeValidated,
              meta: JSON.stringify({}),
            } as CreateTradeHistoryInput;
          }
          case positionSizeDecreaseExecutedEventParser.eventName: {
            const { args } =
              positionSizeDecreaseExecutedEventParser.actionParser(
                actionItem.item,
              );

            if (args.cancelReason !== CancelReason.NONE) {
              return null;
            }

            const collateral = this.gnsService.getCollateral(
              contractId,
              args.collateralIndex,
            );

            return {
              date: actionItem.timestamp,
              pair: this.gnsService.getPairName(
                contractId,
                Number(args.pairIndex),
              ),
              block: actionItem.blockNumber,
              address: actionItem.item.position.address.toLowerCase(),
              action: TradeActionType.TradePosSizeDecrease,
              contractId,
              price: `${Number(args.values.priceImpact.priceAfterImpact) / 1e10}`,
              collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
              long: Number(args.long),
              size: `${Number(
                Number(args.values.newCollateralAmount) /
                  Number(collateral.precision),
              )}`,
              leverage: Number(args.values.newLeverage) / 1e3,
              pnl: `${Number(
                (Number(args.values.partialNetPnlCollateral) -
                  Number(args.values.closingFeeCollateral)) /
                  Number(collateral.precision),
              )}`,
              tradeId: null,
              collateralIndex: Number(args.collateralIndex),
              tradeIndex: Number(args.index),
              collateralDelta: `${
                -Number(args.collateralDelta) / Number(collateral.precision)
              }`,
              leverageDelta: Number(args.leverageDelta) / 1e3,
              marketPrice: `${Number(args.values.priceImpact.priceAfterImpact) / 1e10}`,
              isCounterTrade: false,
              meta: JSON.stringify({}),
            } as CreateTradeHistoryInput;
          }
          case leverageUpdateExecutedEventParser.eventName: {
            const { args } = leverageUpdateExecutedEventParser.actionParser(
              actionItem.item,
            );

            if (args.cancelReason !== CancelReason.NONE) {
              return null;
            }

            const collateral = this.gnsService.getCollateral(
              contractId,
              args.collateralIndex,
            );

            return {
              date: actionItem.timestamp,
              pair: this.gnsService.getPairName(
                contractId,
                Number(args.pairIndex),
              ),
              block: actionItem.blockNumber,
              address: actionItem.item.position.address.toLowerCase(),
              action: TradeActionType.TradeLeverageUpdate,
              contractId,
              price: `${Number(args.oraclePrice) / 1e10}`,
              collateralPriceUsd: '0',
              long: 0,
              size: `${Number(
                Number(args.values.newCollateralAmount) /
                  Number(collateral.precision),
              )}`,
              leverage: Number(args.values.newLeverage) / 1e3,
              pnl: '0',
              tradeId: null,
              collateralIndex: Number(args.collateralIndex),
              tradeIndex: Number(args.index),
              collateralDelta: `${
                ((args.isIncrease ? 1 : -1) * Number(args.collateralDelta)) /
                Number(collateral.precision)
              }`,
              leverageDelta: null,
              marketPrice: null,
              isCounterTrade: false,
              meta: JSON.stringify({}),
            } as CreateTradeHistoryInput;
          }
          case marketExecutedEventParser.eventName: {
            const { args } = marketExecutedEventParser.actionParser(
              actionItem.item,
            );

            const collateral = this.gnsService.getCollateral(
              contractId,
              args.t.collateralIndex,
            );

            const pnl = args.open
              ? '0'
              : `${Number(
                  (Number(args.amountSentToTrader) -
                    Number(args.t.collateralAmount)) /
                    Number(collateral.precision),
                )}`;

            return {
              date: actionItem.timestamp,
              pair: this.gnsService.getPairName(
                contractId,
                Number(args.t.pairIndex),
              ),
              block: actionItem.blockNumber,
              address: actionItem.item.position.address.toLowerCase(),
              action: args.open
                ? TradeActionType.TradeOpenedMarket
                : TradeActionType.TradeClosedMarket,
              contractId,
              price: `${Number(args.priceImpact.priceAfterImpact) / 1e10}`,
              collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
              long: Number(args.t.long),
              size: `${Number(
                Number(args.t.collateralAmount) / Number(collateral.precision),
              )}`,
              leverage: Number(args.t.leverage) / 1e3,
              pnl: pnl,
              tradeId: null,
              collateralIndex: Number(args.t.collateralIndex),
              tradeIndex: Number(args.t.index),
              collateralDelta: null,
              leverageDelta: null,
              marketPrice: `${Number(args.marketPrice) / 1e10}`,
              isCounterTrade: args.t.isCounterTrade,
              meta: JSON.stringify({}),
            } as CreateTradeHistoryInput;
          }
          case limitExecutedEventParser.eventName: {
            const { args } = limitExecutedEventParser.actionParser(
              actionItem.item,
            );

            const collateral = this.gnsService.getCollateral(
              contractId,
              args.t.collateralIndex,
            );

            const actionNameMap: Record<string, string> = {
              [PendingOrderType.LIMIT_OPEN]: TradeActionType.TradeOpenedLimit,
              [PendingOrderType.LIQ_CLOSE]: TradeActionType.TradeClosedLIQ,
              [PendingOrderType.SL_CLOSE]: TradeActionType.TradeClosedSL,
              [PendingOrderType.TP_CLOSE]: TradeActionType.TradeClosedTP,
            };

            if (!actionNameMap[args.orderType]) {
              return null;
            }

            const pnl =
              args.orderType === PendingOrderType.LIMIT_OPEN
                ? '0'
                : `${Number(
                    (Number(args.amountSentToTrader) -
                      Number(args.t.collateralAmount)) /
                      Number(collateral.precision),
                  )}`;

            return {
              date: actionItem.timestamp,
              pair: this.gnsService.getPairName(
                contractId,
                Number(args.t.pairIndex),
              ),
              block: actionItem.blockNumber,
              address: actionItem.item.position.address.toLowerCase(),
              action: actionNameMap[args.orderType],
              contractId,
              price: `${Number(args.oraclePrice) / 1e10}`,
              collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
              long: Number(args.t.long),
              size: `${Number(
                Number(args.t.collateralAmount) / Number(collateral.precision),
              )}`,
              leverage: Number(args.t.leverage) / 1e3,
              pnl: pnl,
              tradeId: null,
              collateralIndex: Number(args.t.collateralIndex),
              tradeIndex: Number(args.t.index),
              collateralDelta: null,
              leverageDelta: null,
              marketPrice: `${Number(args.marketPrice) / 1e10}`,
              isCounterTrade: false,
              meta: JSON.stringify({}),
            } as CreateTradeHistoryInput;
          }
          case tradePositivePnlWithdrawnEventParser.eventName: {
            const { args } = tradePositivePnlWithdrawnEventParser.actionParser(
              actionItem.item,
            );

            const collateral = this.gnsService.getCollateral(
              contractId,
              args.collateralIndex,
            );

            return {
              date: actionItem.timestamp,
              pair: this.gnsService.getPairName(contractId, Number(args.index)),
              block: actionItem.blockNumber,
              address: actionItem.item.position.address.toLowerCase(),
              action: TradeActionType.TradePosPnlRealized,
              contractId,
              price: `${Number(args.priceImpact.priceAfterImpact) / 1e10}`,
              collateralPriceUsd: '0',
              long: 0,
              size: `0`,
              leverage: 0,
              pnl: `${Number(Number(args.pnlWithdrawnCollateral) / Number(collateral.precision))}`,
              tradeId: null,
              collateralIndex: Number(args.collateralIndex),
              tradeIndex: Number(args.index),
              collateralDelta: null,
              leverageDelta: null,
              marketPrice: null,
              isCounterTrade: false,
              meta: JSON.stringify({}),
            } as CreateTradeHistoryInput;
          }
          default: {
            return null;
          }
        }
      })
      .filter((item): item is CreateTradeHistoryInput => !!item);

    await this.createMany(historyInputs);
  }
}

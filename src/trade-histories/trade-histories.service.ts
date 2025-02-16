import { Injectable, Logger } from '@nestjs/common';
import { ActionItem } from 'src/actions/entities/action.entity';

import { PrismaService } from 'src/global/prisma.service';
import {
  CreateTradeHistoryInput,
  GetUserTransactionCountsInput,
} from './dto/trade-history.input';

import { positionSizeIncreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-decrease-executed.parser';
import { leverageUpdateExecutedEventParser } from 'src/actions/eventParsers/leverage-update-executed.parser';
import { marketExecutedEventParser } from 'src/actions/eventParsers/market-executed.parser';
import { limitExecutedEventParser } from 'src/actions/eventParsers/limit-executed.parser';

import { CancelReason, PendingOrderType } from 'src/types';

import { TradingVariableService } from 'src/global/trading-variable.service';
import { getStartOfMonth, getStartOfWeek } from 'src/utils';
import { getStartOfDay } from 'src/utils';
import { TradeTransactionCount } from './entities/trade-history.entity';
import { TradeActionType } from '@prisma/client';

@Injectable()
export class TradeHistoriesService {
  constructor(
    private prismaService: PrismaService,
    private tradingVariableServcie: TradingVariableService,
    private logger: Logger,
  ) {}

  async createMany(inputs: CreateTradeHistoryInput[]) {
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
        contractId,
      },
    });
  }

  async handleActionItems(
    contractId: number,
    timestamp: Date,
    actionItems: { item: ActionItem; blockNumber: number }[],
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

            const collateral = this.tradingVariableServcie.getCollateral(
              contractId,
              args.collateralIndex,
            );

            const leverage = Number(args.values.newLeverage) / 1000;

            return {
              date: timestamp,
              pair: this.tradingVariableServcie.getPairName(
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
                BigInt(args.values.newCollateralAmount) / collateral.precision,
              )}`,
              leverage,
              pnl: `${Number(
                BigInt(args.values.existingPnlCollateral) /
                  collateral.precision,
              )}`,
              tradeId: null,
              collateralIndex: Number(args.collateralIndex),
              tradeIndex: Number(args.index),
              collateralDelta: `${
                BigInt(args.collateralDelta) / collateral.precision
              }`,
              leverageDelta: Number(args.leverageDelta) / 1e3,
              marketPrice: `${Number(args.oraclePrice) / 1e10}`,
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

            const collateral = this.tradingVariableServcie.getCollateral(
              contractId,
              args.collateralIndex,
            );

            return {
              date: timestamp,
              pair: this.tradingVariableServcie.getPairName(
                contractId,
                Number(args.pairIndex),
              ),
              block: actionItem.blockNumber,
              address: actionItem.item.position.address.toLowerCase(),
              action: TradeActionType.TradePosSizeDecrease,
              contractId,
              price: `${Number(args.values.priceAfterImpact) / 1e10}`,
              collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
              long: Number(args.long),
              size: `${Number(
                BigInt(args.values.newCollateralAmount) / collateral.precision,
              )}`,
              leverage: Number(args.values.newLeverage) / 1e3,
              pnl: `${Number(
                BigInt(args.values.collateralSentToTrader) /
                  collateral.precision,
              )}`,
              tradeId: null,
              collateralIndex: Number(args.collateralIndex),
              tradeIndex: Number(args.index),
              collateralDelta: `${
                BigInt(args.collateralDelta) / collateral.precision
              }`,
              leverageDelta: Number(args.leverageDelta) / 1e3,
              marketPrice: `${Number(args.oraclePrice) / 1e10}`,
            } as CreateTradeHistoryInput;
          }
          case leverageUpdateExecutedEventParser.eventName: {
            const { args } = leverageUpdateExecutedEventParser.actionParser(
              actionItem.item,
            );

            if (args.cancelReason !== CancelReason.NONE) {
              return null;
            }

            const collateral = this.tradingVariableServcie.getCollateral(
              contractId,
              args.collateralIndex,
            );

            return {
              date: timestamp,
              pair: this.tradingVariableServcie.getPairName(
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
                BigInt(args.values.newCollateralAmount) / collateral.precision,
              )}`,
              leverage: Number(args.values.newLeverage) / 1e3,
              pnl: '0',
              tradeId: null,
              collateralIndex: Number(args.collateralIndex),
              tradeIndex: Number(args.index),
              collateralDelta: `${
                BigInt(args.collateralDelta) / collateral.precision
              }`,
              leverageDelta: null,
              marketPrice: null,
            } as CreateTradeHistoryInput;
          }
          case marketExecutedEventParser.eventName: {
            const { args } = marketExecutedEventParser.actionParser(
              actionItem.item,
            );

            const collateral = this.tradingVariableServcie.getCollateral(
              contractId,
              args.t.collateralIndex,
            );

            return {
              date: timestamp,
              pair: this.tradingVariableServcie.getPairName(
                contractId,
                Number(args.t.pairIndex),
              ),
              block: actionItem.blockNumber,
              address: actionItem.item.position.address.toLowerCase(),
              action: args.open
                ? TradeActionType.TradeOpenedMarket
                : TradeActionType.TradeClosedMarket,
              contractId,
              price: `${Number(args.oraclePrice) / 1e10}`,
              collateralPriceUsd: `${Number(args.collateralPriceUsd) / 1e8}`,
              long: Number(args.t.long),
              size: `${Number(
                BigInt(args.t.collateralAmount) / collateral.precision,
              )}`,
              leverage: Number(args.t.leverage) / 1e3,
              pnl: `${Number(
                BigInt(args.amountSentToTrader) / collateral.precision,
              )}`,
              tradeId: null,
              collateralIndex: Number(args.t.collateralIndex),
              tradeIndex: Number(args.t.index),
              collateralDelta: null,
              leverageDelta: null,
              marketPrice: `${Number(args.marketPrice) / 1e10}`,
            } as CreateTradeHistoryInput;
          }
          case limitExecutedEventParser.eventName: {
            const { args } = limitExecutedEventParser.actionParser(
              actionItem.item,
            );

            const collateral = this.tradingVariableServcie.getCollateral(
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

            return {
              date: timestamp,
              pair: this.tradingVariableServcie.getPairName(
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
                BigInt(args.t.collateralAmount) / collateral.precision,
              )}`,
              leverage: Number(args.t.leverage) / 1e3,
              pnl: `${Number(
                BigInt(args.amountSentToTrader) / collateral.precision,
              )}`,
              tradeId: null,
              collateralIndex: Number(args.t.collateralIndex),
              tradeIndex: Number(args.t.index),
              collateralDelta: null,
              leverageDelta: null,
              marketPrice: `${Number(args.marketPrice) / 1e10}`,
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

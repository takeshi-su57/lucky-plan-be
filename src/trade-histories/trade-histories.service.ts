import { Injectable, Logger } from '@nestjs/common';
import { ActionItem } from 'src/actions/entities/action.entity';

import { PrismaService } from 'src/global/prisma.service';
import { CreateTradeHistoryInput } from './dto/trade-history.input';
import { positionSizeIncreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-increase-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-decrease-executed.parser';

import { CancelReason } from 'src/types';
import {
  isCloseMissionAction,
  isOpenMissionAction,
  missionEventNames,
  missionEventParsers,
} from 'src/actions/eventParsers';
import { TradingVariableService } from 'src/global/trading-variable.service';

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

  getTradeHistories(addresses: string[], contractId: number) {
    return this.prismaService.tradeHistory.findMany({
      where: {
        address: {
          in: addresses,
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
    const historyInputs: CreateTradeHistoryInput[] = actionItems
      .map((action) => {
        let usdIn = 0;
        let usdOut = 0;
        let usdPnl = 0;

        switch (action.item.name) {
          case positionSizeIncreaseExecutedEventParser.eventName: {
            const { args } =
              positionSizeIncreaseExecutedEventParser.actionParser(action.item);

            if (args.cancelReason !== CancelReason.NONE) {
              return null;
            }

            const collateral = this.tradingVariableServcie.getCollateral(
              contractId,
              args.collateralIndex,
            );

            const realCollateralDelta = Number(
              BigInt(args.collateralDelta) / collateral.precision,
            );
            const realCollateralPriceUsd =
              Number(args.collateralPriceUsd) / 100000000; // chainlink precision

            usdOut = Number(realCollateralDelta * realCollateralPriceUsd);

            break;
          }
          case positionSizeDecreaseExecutedEventParser.eventName: {
            const { args } =
              positionSizeDecreaseExecutedEventParser.actionParser(action.item);

            if (args.cancelReason !== CancelReason.NONE) {
              return null;
            }

            const collateral = this.tradingVariableServcie.getCollateral(
              contractId,
              args.collateralIndex,
            );

            const realCollateralDelta = Number(
              BigInt(args.collateralDelta) / collateral.precision,
            );
            const realCollateralPriceUsd =
              Number(args.collateralPriceUsd) / 100000000;

            usdIn = Number(realCollateralDelta * realCollateralPriceUsd);
            break;
          }
          default: {
            if (missionEventNames.includes(action.item.name)) {
              const event = missionEventParsers
                .find((parser) => parser.eventName === action.item.name)!
                .actionParser(action.item);
              const { t, collateralPriceUsd, amountSentToTrader } = event.args;

              const collateral = this.tradingVariableServcie.getCollateral(
                contractId,
                t.collateralIndex,
              );

              const realCollateralAmount = Number(
                BigInt(t.collateralAmount) / collateral.precision,
              );
              const realCollateralPriceUsd =
                Number(collateralPriceUsd) / 100000000;
              const realAmountSentToTrader = Number(
                BigInt(amountSentToTrader) / collateral.precision,
              );

              if (isOpenMissionAction(action.item)) {
                usdOut = Number(realCollateralAmount * realCollateralPriceUsd);
              } else if (isCloseMissionAction(action.item)) {
                usdIn = Number(realAmountSentToTrader * realCollateralPriceUsd);

                usdPnl =
                  (realAmountSentToTrader - realCollateralAmount) *
                  realCollateralPriceUsd;
              } else {
                return null;
              }
            } else {
              return null;
            }
          }
        }

        return {
          address: action.item.position.address.toLowerCase(),
          eventName: action.item.name,
          contractId,
          in: usdIn,
          out: usdOut,
          pnl: usdPnl,
          blockNumber: action.blockNumber,
          timestamp,
        };
      })
      .filter((item) => !!item);

    await this.createMany(historyInputs);
  }
}

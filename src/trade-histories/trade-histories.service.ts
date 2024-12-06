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

@Injectable()
export class TradeHistoriesService {
  constructor(
    private prismaService: PrismaService,
    private logger: Logger,
  ) {}

  async createMany(inputs: CreateTradeHistoryInput[]) {
    return await this.prismaService.tradeHistory.createManyAndReturn({
      data: inputs,
    });
  }

  getTradeHistories(_address: string, _contractId: number) {
    return this.prismaService.tradeHistory.findMany();
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

            usdOut = Number(
              (BigInt(args.collateralDelta) * BigInt(args.collateralPriceUsd)) /
                1000000n,
            );

            break;
          }
          case positionSizeDecreaseExecutedEventParser.eventName: {
            const { args } =
              positionSizeDecreaseExecutedEventParser.actionParser(action.item);

            if (args.cancelReason !== CancelReason.NONE) {
              return null;
            }

            usdIn = Number(
              (BigInt(args.collateralDelta) * BigInt(args.collateralPriceUsd)) /
                1000000n,
            );

            break;
          }
          default: {
            if (missionEventNames.includes(action.item.name)) {
              const event = missionEventParsers
                .find((parser) => parser.eventName === action.item.name)!
                .actionParser(action.item);
              const { t, collateralPriceUsd, amountSentToTrader } = event.args;

              if (isOpenMissionAction(action.item)) {
                usdOut = Number(
                  (BigInt(t.collateralAmount) * BigInt(collateralPriceUsd)) /
                    1000000n,
                );
              } else if (isCloseMissionAction(action.item)) {
                usdIn = Number(
                  (BigInt(amountSentToTrader) * BigInt(collateralPriceUsd)) /
                    1000000n,
                );

                usdPnl =
                  usdIn -
                  Number(
                    (BigInt(t.collateralAmount) * BigInt(collateralPriceUsd)) /
                      1000000n,
                  );
              } else {
                return null;
              }
            } else {
              return null;
            }
          }
        }

        return {
          address: action.item.position.address,
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

    return this.createMany(historyInputs);
  }
}

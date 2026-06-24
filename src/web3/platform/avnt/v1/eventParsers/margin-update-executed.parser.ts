import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { tradingAbi } from '../abi/Trading';
import { actionToEvent, eventToAction } from 'src/utils';
import { getAvntPositionKey } from '../../utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getPairName } from '../configs';
import { MarginUpdateType } from '../types';

export const eventName = 'MarginUpdated';

export const abiItem = getAbiItem({
  abi: tradingAbi,
  name: eventName,
});

export type MarginUpdateEvent = DecodeEventLogReturnType<
  typeof tradingAbi,
  typeof eventName
>;
export type MarginUpdateEventArgs = MarginUpdateEvent['args'];

export function parseMarginUpdateEvent(event: MarginUpdateEvent) {
  return eventToAction(
    event.eventName,
    getAvntPositionKey(event.args.trader, Number(event.args.index)),
    event.args.trader,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  event: MarginUpdateEvent,
): PurePerpTradeHistory | null {
  const pairName = getPairName(Number(event.args.pairIndex));

  if (!pairName) {
    return null;
  }

  const usdPnl = 0;
  const usdBasePnl = 0;
  const usdFee = 0;

  const collateralInUsd = Number(event.args.newTrade.initialPosToken) / 1e6;
  const leverage = Number(event.args.newTrade.leverage) / 1e10;

  const sizeInUsd = collateralInUsd * leverage;

  const collateralDeltaUsd = 0;
  const leverageDelta = 0;
  const sizeDeltaUsd = collateralDeltaUsd * leverageDelta;

  return {
    positionKey: getAvntPositionKey(
      event.args.trader,
      Number(event.args.index),
    ),
    address: event.args.trader.toLowerCase() as `0x${string}`,
    pair: pairName,
    operation:
      event.args._type === MarginUpdateType.WITHDRAW
        ? PerpTradeHistoryOperation.INCREASE_LEVERAGE
        : PerpTradeHistoryOperation.DECREASE_LEVERAGE,
    usdPnl,
    usdBasePnl,
    usdFee,
    sizeInUsd,
    leverage,
    collateralInUsd,
    collateralDeltaUsd,
    sizeDeltaUsd,
    leverageDelta,
    isLong: true,
    price: Number(event.args.newTrade.openPrice) / 1e10,
  };
}

export const marginUpdateExecutedEventParser = {
  eventName,
  logParser: parseMarginUpdateEvent,
  actionParser: actionToEvent<MarginUpdateEventArgs>,
  eventToPerpTradeHistory,
};

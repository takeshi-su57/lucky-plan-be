import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';
import { PurePerpTradeHistory } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

export const eventName = 'MarketOpenCanceled';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketOpenCanceledEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type MarketOpenCanceledEventArgs = MarketOpenCanceledEvent['args'];

export function parseMarketOpenCanceledEvent(event: MarketOpenCanceledEvent) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.orderId.user, event.args.orderId.index),
    event.args.orderId.user,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  _chainId: number,
  _event: MarketOpenCanceledEvent,
): PurePerpTradeHistory | null {
  return null;
}

export const marketOpenCanceledEventParser = {
  eventName,
  logParser: parseMarketOpenCanceledEvent,
  actionParser: actionToEvent<MarketOpenCanceledEventArgs>,
  eventToPerpTradeHistory,
};

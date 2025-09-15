import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';
import { PerpTradeHistory } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

export const eventName = 'MarketOrderInitiated';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketOrderInitiatedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type MarketOrderInitiatedEventArgs = MarketOrderInitiatedEvent['args'];

export function parseMarketOrderInitiatedEvent(
  event: MarketOrderInitiatedEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.orderId.user, event.args.orderId.index),
    event.args.orderId.user,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: MarketOrderInitiatedEvent,
): PerpTradeHistory | null {
  return null;
}

export const marketOrderInitiatedEventParser = {
  eventName,
  logParser: parseMarketOrderInitiatedEvent,
  actionParser: actionToEvent<MarketOrderInitiatedEventArgs>,
  eventToPerpTradeHistory,
};

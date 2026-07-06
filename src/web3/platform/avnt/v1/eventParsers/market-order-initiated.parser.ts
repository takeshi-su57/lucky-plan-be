import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { tradingAbi } from '../abi/Trading';
import { actionToEvent, eventToAction } from 'src/utils';
import { getAvntPositionKey } from '../../utils';
import { PurePerpTradeHistory } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

export const eventName = 'MarketOrderInitiated';

export const abiItem = getAbiItem({
  abi: tradingAbi,
  name: eventName,
});

export type MarketOrderInitiatedEvent = DecodeEventLogReturnType<
  typeof tradingAbi,
  typeof eventName
>;
export type MarketOrderInitiatedEventArgs = MarketOrderInitiatedEvent['args'];

export function parseMarketOrderInitiatedEvent(
  event: MarketOrderInitiatedEvent,
) {
  return eventToAction(
    event.eventName,
    getAvntPositionKey(
      event.args.trader,
      Number(event.args.pairIndex),
      Number(event.args.orderId),
    ),
    event.args.trader,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  _event: MarketOrderInitiatedEvent,
): PurePerpTradeHistory | null {
  return null;
}

export const marketOrderInitiatedEventParser = {
  eventName,
  logParser: parseMarketOrderInitiatedEvent,
  actionParser: actionToEvent<MarketOrderInitiatedEventArgs>,
  eventToPerpTradeHistory,
};

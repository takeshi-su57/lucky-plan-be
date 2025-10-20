import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { tradingCallbackAbi } from '../abi/ICallback';
import { actionToEvent, eventToAction } from 'src/utils';
import { getAvntPositionKey } from '../../utils';
import { PerpTradeHistory } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

export const eventName = 'MarketOpenCanceled';

export const abiItem = getAbiItem({
  abi: tradingCallbackAbi,
  name: eventName,
});

export type MarketOpenCanceledEvent = DecodeEventLogReturnType<
  typeof tradingCallbackAbi,
  typeof eventName
>;
export type MarketOpenCanceledEventArgs = MarketOpenCanceledEvent['args'];

export function parseMarketOpenCanceledEvent(event: MarketOpenCanceledEvent) {
  return eventToAction(
    event.eventName,
    getAvntPositionKey(event.args.trader, Number(event.args.orderId)),
    event.args.trader,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  event: MarketOpenCanceledEvent,
): PerpTradeHistory | null {
  return null;
}

export const marketOpenCanceledEventParser = {
  eventName,
  logParser: parseMarketOpenCanceledEvent,
  actionParser: actionToEvent<MarketOpenCanceledEventArgs>,
  eventToPerpTradeHistory,
};

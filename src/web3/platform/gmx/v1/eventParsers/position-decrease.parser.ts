import { actionToEvent, eventToAction } from 'src/utils';
import { PerpTradeHistoryOperation } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

import { buildGmxV1PerpTradeHistory, toBigInt } from './utils';
import { GmxV1PositionEvent, GmxV1PositionEventArgs } from './types';

export const eventName = 'DecreasePosition';

export type PositionDecreaseEvent = GmxV1PositionEvent<typeof eventName>;

export function parsePositionDecreaseEvent(event: PositionDecreaseEvent) {
  return eventToAction(
    event.eventName,
    event.args.positionKey,
    event.args.account,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: PositionDecreaseEvent,
) {
  const sizeInUsd = toBigInt(event.args.sizeInUsd);
  const sizeDelta = toBigInt(event.args.sizeDelta);
  let operation = PerpTradeHistoryOperation.DECREASE_SIZE;

  if (sizeInUsd === 0n) {
    operation = PerpTradeHistoryOperation.CLOSE;
  } else if (sizeDelta === 0n) {
    operation = PerpTradeHistoryOperation.INCREASE_LEVERAGE;
  }

  return buildGmxV1PerpTradeHistory(chainId, event.args, operation);
}

export const positionDecreaseEventParser = {
  eventName,
  logParser: parsePositionDecreaseEvent,
  actionParser: actionToEvent<GmxV1PositionEventArgs>,
  eventToPerpTradeHistory,
};

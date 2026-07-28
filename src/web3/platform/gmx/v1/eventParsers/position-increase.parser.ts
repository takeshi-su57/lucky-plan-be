import { actionToEvent, eventToAction } from 'src/utils';
import { PerpTradeHistoryOperation } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

import { buildGmxV1PerpTradeHistory, toBigInt } from './utils';
import { GmxV1PositionEvent, GmxV1PositionEventArgs } from './types';

export const eventName = 'IncreasePosition';

export type PositionIncreaseEvent = GmxV1PositionEvent<typeof eventName>;

export function parsePositionIncreaseEvent(event: PositionIncreaseEvent) {
  return eventToAction(
    event.eventName,
    event.args.positionKey,
    event.args.account,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: PositionIncreaseEvent,
) {
  const sizeInUsd = toBigInt(event.args.sizeInUsd);
  const sizeDelta = toBigInt(event.args.sizeDelta);
  let operation = PerpTradeHistoryOperation.INCREASE_SIZE;

  if (sizeInUsd === sizeDelta) {
    operation = PerpTradeHistoryOperation.OPEN;
  } else if (sizeDelta === 0n) {
    operation = PerpTradeHistoryOperation.DECREASE_LEVERAGE;
  }

  return buildGmxV1PerpTradeHistory(chainId, event.args, operation);
}

export const positionIncreaseEventParser = {
  eventName,
  logParser: parsePositionIncreaseEvent,
  actionParser: actionToEvent<GmxV1PositionEventArgs>,
  eventToPerpTradeHistory,
};

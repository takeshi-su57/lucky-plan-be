import { actionToEvent, eventToAction } from 'src/utils';
import { PerpTradeHistoryOperation } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

import { buildGmxV1PerpTradeHistory } from './utils';
import { GmxV1PositionEvent, GmxV1PositionEventArgs } from './types';

export const eventName = 'LiquidatePosition';

export type LiquidatePositionEvent = GmxV1PositionEvent<typeof eventName>;

export function parseLiquidatePositionEvent(event: LiquidatePositionEvent) {
  return eventToAction(
    event.eventName,
    event.args.positionKey,
    event.args.account,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: LiquidatePositionEvent,
) {
  return buildGmxV1PerpTradeHistory(
    chainId,
    event.args,
    PerpTradeHistoryOperation.CLOSE,
  );
}

export const liquidatePositionEventParser = {
  eventName,
  logParser: parseLiquidatePositionEvent,
  actionParser: actionToEvent<GmxV1PositionEventArgs>,
  eventToPerpTradeHistory,
};

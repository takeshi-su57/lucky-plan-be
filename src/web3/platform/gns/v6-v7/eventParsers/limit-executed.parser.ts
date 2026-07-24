import { actionToEvent, eventToAction } from 'src/utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getLegacyGnsPositionKey } from '../../utils';
import { LegacyLimitExecutedArgs, LegacyLimitExecutedEvent } from './types';
import { legacyExecutionToPerpTradeHistory } from './execution.utils';

export const eventName = 'LimitExecuted';

const LEGACY_OPEN_ORDER_TYPE = 3;

export function parseLimitExecutedEvent(event: LegacyLimitExecutedEvent) {
  return eventToAction(
    event.eventName,
    getLegacyGnsPositionKey(
      event.args.t.trader,
      Number(event.args.t.pairIndex),
      Number(event.args.t.index),
    ),
    event.args.t.trader,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: LegacyLimitExecutedEvent,
  contractAddress: string,
): PurePerpTradeHistory | null {
  return legacyExecutionToPerpTradeHistory({
    chainId,
    contractAddress,
    args: event.args,
    operation:
      Number(event.args.orderType) === LEGACY_OPEN_ORDER_TYPE
        ? PerpTradeHistoryOperation.OPEN
        : PerpTradeHistoryOperation.CLOSE,
  });
}

export const limitExecutedEventParser = {
  eventName,
  logParser: parseLimitExecutedEvent,
  actionParser: actionToEvent<LegacyLimitExecutedArgs>,
  eventToPerpTradeHistory,
};

import { actionToEvent, eventToAction } from 'src/utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getGnsPositionKey } from '../../utils';
import {
  EarlyDiamondLimitExecutedArgs,
  EarlyDiamondLimitExecutedEvent,
} from './types';
import { earlyDiamondExecutionToPerpTradeHistory } from './execution.utils';

export const eventName = 'LimitExecuted';

const OPEN_ORDER_TYPES = new Set([0, 2, 3]);
const CLOSE_ORDER_TYPES = new Set([1, 4, 5, 6]);

export function parseLimitExecutedEvent(event: EarlyDiamondLimitExecutedEvent) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.t.user, Number(event.args.t.index)),
    event.args.t.user,
    event.args,
  );
}

export function getLimitExecutionOperation(
  orderType: number | bigint,
): PerpTradeHistoryOperation | null {
  const normalizedOrderType = Number(orderType);

  if (OPEN_ORDER_TYPES.has(normalizedOrderType)) {
    return PerpTradeHistoryOperation.OPEN;
  }

  if (CLOSE_ORDER_TYPES.has(normalizedOrderType)) {
    return PerpTradeHistoryOperation.CLOSE;
  }

  return null;
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: EarlyDiamondLimitExecutedEvent,
): PurePerpTradeHistory | null {
  const operation = getLimitExecutionOperation(event.args.orderType);

  if (!operation) {
    return null;
  }

  return earlyDiamondExecutionToPerpTradeHistory({
    chainId,
    args: event.args,
    operation,
  });
}

export const limitExecutedEventParser = {
  eventName,
  logParser: parseLimitExecutedEvent,
  actionParser: actionToEvent<EarlyDiamondLimitExecutedArgs>,
  eventToPerpTradeHistory,
};

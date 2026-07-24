import { actionToEvent, eventToAction } from 'src/utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getGnsPositionKey } from '../../utils';
import {
  EarlyDiamondMarketExecutedArgs,
  EarlyDiamondMarketExecutedEvent,
} from './types';
import { earlyDiamondExecutionToPerpTradeHistory } from './execution.utils';

export const eventName = 'MarketExecuted';

export function parseMarketExecutedEvent(
  event: EarlyDiamondMarketExecutedEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.t.user, Number(event.args.t.index)),
    event.args.t.user,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: EarlyDiamondMarketExecutedEvent,
): PurePerpTradeHistory | null {
  return earlyDiamondExecutionToPerpTradeHistory({
    chainId,
    args: event.args,
    operation: event.args.open
      ? PerpTradeHistoryOperation.OPEN
      : PerpTradeHistoryOperation.CLOSE,
  });
}

export const marketExecutedEventParser = {
  eventName,
  logParser: parseMarketExecutedEvent,
  actionParser: actionToEvent<EarlyDiamondMarketExecutedArgs>,
  eventToPerpTradeHistory,
};

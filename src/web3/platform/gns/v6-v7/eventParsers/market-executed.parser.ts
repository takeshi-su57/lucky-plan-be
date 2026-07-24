import { actionToEvent, eventToAction } from 'src/utils';
import {
  PurePerpTradeHistory,
  PerpTradeHistoryOperation,
} from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { getLegacyGnsPositionKey } from '../../utils';
import { LegacyMarketExecutedArgs, LegacyMarketExecutedEvent } from './types';
import { legacyExecutionToPerpTradeHistory } from './execution.utils';

export const eventName = 'MarketExecuted';

export function parseMarketExecutedEvent(event: LegacyMarketExecutedEvent) {
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
  event: LegacyMarketExecutedEvent,
  contractAddress: string,
): PurePerpTradeHistory | null {
  return legacyExecutionToPerpTradeHistory({
    chainId,
    contractAddress,
    args: event.args,
    operation: event.args.open
      ? PerpTradeHistoryOperation.OPEN
      : PerpTradeHistoryOperation.CLOSE,
  });
}

export const marketExecutedEventParser = {
  eventName,
  logParser: parseMarketExecutedEvent,
  actionParser: actionToEvent<LegacyMarketExecutedArgs>,
  eventToPerpTradeHistory,
};

import type {
  Action,
  ActionItem,
} from 'src/microservices/apiService/modules/actions/entities/action.entity';
import type { PurePerpTradeHistory } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

import {
  positionIncreaseEventParser,
  PositionIncreaseEvent,
} from './position-increase.parser';
import {
  positionDecreaseEventParser,
  PositionDecreaseEvent,
} from './position-decrease.parser';
import {
  liquidatePositionEventParser,
  LiquidatePositionEvent,
} from './liquidate-position.parser';
import { normalizeGmxV1EventLogs } from './normalize-event-logs';
import { toBigInt } from './utils';

export type GmxV1TradeEvent =
  | PositionIncreaseEvent
  | PositionDecreaseEvent
  | LiquidatePositionEvent;

export const eventParsers = [
  positionIncreaseEventParser,
  positionDecreaseEventParser,
  liquidatePositionEventParser,
];

export const eventParsersMap = Object.fromEntries(
  eventParsers.map((parser) => [parser.eventName, parser]),
);

export function eventToActionParser(event: GmxV1TradeEvent): ActionItem {
  const parser = eventParsersMap[event.eventName];

  if (!parser) {
    throw new Error(`No parser found for event: ${event.eventName}`);
  }

  return parser.logParser(event as never);
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: GmxV1TradeEvent,
): PurePerpTradeHistory | null {
  const parser = eventParsersMap[event.eventName];

  if (!parser) {
    return null;
  }

  return parser.eventToPerpTradeHistory(chainId, event as never);
}

export function isOpenMissionAction(action: Action | ActionItem) {
  if (action.name !== positionIncreaseEventParser.eventName) {
    return false;
  }

  const event = positionIncreaseEventParser.actionParser(action);

  return toBigInt(event.args.sizeInUsd) === toBigInt(event.args.sizeDelta);
}

export function isCloseMissionAction(action: Action | ActionItem) {
  if (action.name === liquidatePositionEventParser.eventName) {
    return true;
  }

  if (action.name !== positionDecreaseEventParser.eventName) {
    return false;
  }

  const event = positionDecreaseEventParser.actionParser(action);

  return toBigInt(event.args.sizeInUsd) === 0n;
}

export { normalizeGmxV1EventLogs };

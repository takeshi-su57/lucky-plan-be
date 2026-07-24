import { DecodeEventLogReturnType } from 'viem';
import { EventEmitterAbi } from '../abi/EventEmitter';
import { positionIncreaseEventParser } from './position-increase.parser';
import { positionDecreaseEventParser } from './position-decrease.parser';
import type { PositionIncreaseEvent } from './position-increase.parser';
import type { PositionDecreaseEvent } from './position-decrease.parser';
import type {
  ActionItem,
  Action,
} from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { PurePerpTradeHistory } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

export type EventLog = DecodeEventLogReturnType<
  typeof EventEmitterAbi,
  'EventLog'
>;

export type EventLogData = EventLog['args']['eventData'];

export function parseEventData<T>(eventData: EventLogData) {
  const event: Record<string, any> = {};

  const keys = [
    'addressItems',
    'uintItems',
    'intItems',
    'boolItems',
    'bytes32Items',
    'bytesItems',
    'stringItems',
  ];

  for (const key of keys) {
    const subItems = eventData[key as keyof EventLogData];

    subItems.items.forEach((item) => {
      event[item.key] = item.value;
    });

    subItems.arrayItems.forEach((item) => {
      event[item.key] = item.value;
    });
  }

  return event as T;
}

export function parseEvent(eventName: string, eventData: EventLogData) {
  return {
    eventName,
    args: parseEventData(eventData),
  };
}

export const eventParsers = [
  positionIncreaseEventParser,
  positionDecreaseEventParser,
];

export const registeredEventNames = eventParsers.map((item) => item.eventName);

export const eventParsersMap = Object.fromEntries(
  eventParsers.map((parser) => [parser.eventName, parser]),
);

export function eventToActionParser(
  event: PositionIncreaseEvent | PositionDecreaseEvent,
): ActionItem {
  const parser = eventParsersMap[event.eventName];

  if (!parser) {
    throw new Error(`No parser found for event: ${event.eventName}`);
  }

  return parser.logParser(event as any);
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: PositionIncreaseEvent | PositionDecreaseEvent,
  _contractAddress: string,
): PurePerpTradeHistory | null {
  return eventParsersMap[event.eventName].eventToPerpTradeHistory(
    chainId,
    event as any,
  );
}

export function isOpenMissionAction(action: Action | ActionItem) {
  if (action.name === positionIncreaseEventParser.eventName) {
    const event = positionIncreaseEventParser.actionParser(action);

    // it's the first event for increase the
    return event.args.sizeInUsd === event.args.sizeDeltaUsd;
  } else {
    return false;
  }
}

export function isCloseMissionAction(action: Action | ActionItem) {
  if (action.name === positionDecreaseEventParser.eventName) {
    const event = positionIncreaseEventParser.actionParser(action);

    return Number(event.args.sizeInUsd) === 0;
  } else {
    return false;
  }
}

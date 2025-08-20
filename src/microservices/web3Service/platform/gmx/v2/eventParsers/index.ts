import { EventEmitterAbi } from '../abi/EventEmitter';
import { DecodeEventLogReturnType } from 'viem';

export type EventLog = DecodeEventLogReturnType<
  typeof EventEmitterAbi,
  'EventLog'
>;

export type EventLogData = EventLog['args']['eventData'];

export type ActionItem = {
  eventName: string;
  args: string;
};

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

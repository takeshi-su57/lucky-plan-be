import {
  Action,
  ActionItem,
} from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { PurePerpTradeHistory } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { limitExecutedEventParser } from './limit-executed.parser';
import { marketExecutedEventParser } from './market-executed.parser';
import { LegacyRegisteredEvent } from './types';

export const eventParsers = [
  marketExecutedEventParser,
  limitExecutedEventParser,
];

const eventParsersMap: Record<
  string,
  {
    logParser: (event: any) => ActionItem;
    actionParser: (action: Action | ActionItem) => any;
    eventToPerpTradeHistory: (
      chainId: number,
      event: any,
      contractAddress: string,
    ) => PurePerpTradeHistory | null;
  }
> = Object.fromEntries(
  eventParsers.map((parser) => [parser.eventName, parser]),
);

function getParser(eventName: string) {
  const parser = eventParsersMap[eventName];

  if (!parser) {
    throw new Error(`Unsupported legacy GNS event: ${eventName}`);
  }

  return parser;
}

export function eventToActionParser(event: LegacyRegisteredEvent): ActionItem {
  return getParser(event.eventName).logParser(event);
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: LegacyRegisteredEvent,
  contractAddress: string,
): PurePerpTradeHistory | null {
  return getParser(event.eventName).eventToPerpTradeHistory(
    chainId,
    event,
    contractAddress,
  );
}

export function isOpenMissionAction(action: Action | ActionItem) {
  if (action.name === marketExecutedEventParser.eventName) {
    return marketExecutedEventParser.actionParser(action).args.open;
  }

  if (action.name === limitExecutedEventParser.eventName) {
    return (
      Number(limitExecutedEventParser.actionParser(action).args.orderType) === 3
    );
  }

  return false;
}

export function isCloseMissionAction(action: Action | ActionItem) {
  if (action.name === marketExecutedEventParser.eventName) {
    return !marketExecutedEventParser.actionParser(action).args.open;
  }

  if (action.name === limitExecutedEventParser.eventName) {
    return (
      Number(limitExecutedEventParser.actionParser(action).args.orderType) !== 3
    );
  }

  return false;
}

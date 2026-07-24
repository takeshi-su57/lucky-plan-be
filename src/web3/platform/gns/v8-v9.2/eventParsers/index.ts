import {
  Action,
  ActionItem,
} from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { PurePerpTradeHistory } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';
import { limitExecutedEventParser } from './limit-executed.parser';
import { marketExecutedEventParser } from './market-executed.parser';
import { positionSizeDecreaseExecutedEventParser } from './position-size-decrease-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from './position-size-increase-executed.parser';
import { EarlyDiamondRegisteredEvent } from './types';

export const missionEventParsers = [
  marketExecutedEventParser,
  limitExecutedEventParser,
];
export const missionEventNames = missionEventParsers.map(
  (parser) => parser.eventName,
);

export const updateEventParsers = [
  positionSizeIncreaseExecutedEventParser,
  positionSizeDecreaseExecutedEventParser,
];
export const updateEventNames = updateEventParsers.map(
  (parser) => parser.eventName,
);

export const eventParsers = [...missionEventParsers, ...updateEventParsers];

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
    throw new Error(`Unsupported GNS V8/V9.2 event: ${eventName}`);
  }

  return parser;
}

export function eventToActionParser(
  event: EarlyDiamondRegisteredEvent,
): ActionItem {
  return getParser(event.eventName).logParser(event);
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: EarlyDiamondRegisteredEvent,
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
    const orderType = Number(
      limitExecutedEventParser.actionParser(action).args.orderType,
    );
    return [0, 2, 3].includes(orderType);
  }

  return false;
}

export function isCloseMissionAction(action: Action | ActionItem) {
  if (action.name === marketExecutedEventParser.eventName) {
    return !marketExecutedEventParser.actionParser(action).args.open;
  }

  if (action.name === limitExecutedEventParser.eventName) {
    const orderType = Number(
      limitExecutedEventParser.actionParser(action).args.orderType,
    );
    return [1, 4, 5, 6].includes(orderType);
  }

  return false;
}

export function isSameUpdateAction(
  leaderAction: Action,
  followerAction: Action,
) {
  return (
    updateEventNames.includes(leaderAction.name) &&
    updateEventNames.includes(followerAction.name) &&
    leaderAction.name === followerAction.name
  );
}

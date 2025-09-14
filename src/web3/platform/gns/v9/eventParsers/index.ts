import { leverageUpdateExecutedEventParser } from './leverage-update-executed.parser';
// import { leverageUpdateInitiatedEventParser } from 'src/actions/eventParsers/leverage-update-initiated.parser';
import { limitExecutedEventParser } from './limit-executed.parser';
import { marketCloseCanceledEventParser } from './market-close-canceled';
import { marketExecutedEventParser } from './market-executed.parser';
import { marketOpenCanceledEventParser } from './market-open-canceled';
import { marketOrderInitiatedEventParser } from './market-order-initiated.parser';
import { positionSizeDecreaseExecutedEventParser } from './position-size-decrease-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from './position-size-increase-executed.parser';

import { tradeMaxClosingSlippagePUpdatedEventParser } from './trade-max-closing-slippage-p-updated.parser';

import { PendingOrderType, RegisteredEventType } from '../types';
import {
  Action,
  ActionItem,
} from 'src/microservices/apiService/modules/actions/entities/action.entity';
import { PerpTradeHistory } from 'src/microservices/apiService/modules/trade-histories/entities/event-logs.entity';

export const missionEventParsers = [
  limitExecutedEventParser,
  marketExecutedEventParser,
];

export const missionEventNames = missionEventParsers.map(
  (item) => item.eventName,
);

export const updateEventParsers = [
  tradeMaxClosingSlippagePUpdatedEventParser,
  leverageUpdateExecutedEventParser,
  positionSizeDecreaseExecutedEventParser,
  positionSizeIncreaseExecutedEventParser,
];

export const updateEventNames = updateEventParsers.map(
  (item) => item.eventName,
);

export const missionCanceledEventParsers = [
  marketCloseCanceledEventParser,
  marketOpenCanceledEventParser,
];

export const missionCanceledEventNames = missionCanceledEventParsers.map(
  (item) => item.eventName,
);

export const eventParsers = [
  marketOrderInitiatedEventParser,
  ...missionEventParsers,
  ...updateEventParsers,
  ...missionCanceledEventParsers,
];

export const registeredEventNames = eventParsers.map((item) => item.eventName);

export const eventParsersMap = Object.fromEntries(
  eventParsers.map((parser) => [parser.eventName, parser]),
);

export function eventToActionParser(event: RegisteredEventType): ActionItem {
  return eventParsersMap[event.eventName].logParser(event as any);
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: RegisteredEventType,
): PerpTradeHistory | null {
  return eventParsersMap[event.eventName].eventToPerpTradeHistory(
    chainId,
    event as any,
  );
}

export function isOpenMissionAction(action: Action | ActionItem) {
  if (!missionEventNames.includes(action.name)) {
    return false;
  }

  if (action.name === marketExecutedEventParser.eventName) {
    return marketExecutedEventParser.actionParser(action).args.open;
  } else {
    return [PendingOrderType.LIMIT_OPEN, PendingOrderType.STOP_OPEN].includes(
      limitExecutedEventParser.actionParser(action).args.orderType,
    );
  }
}

export function isCloseMissionAction(action: Action | ActionItem) {
  if (!missionEventNames.includes(action.name)) {
    return false;
  }

  if (action.name === marketExecutedEventParser.eventName) {
    return !marketExecutedEventParser.actionParser(action).args.open;
  } else {
    return [
      PendingOrderType.LIQ_CLOSE,
      PendingOrderType.SL_CLOSE,
      PendingOrderType.TP_CLOSE,
    ].includes(limitExecutedEventParser.actionParser(action).args.orderType);
  }
}

export function isSameUpdateAction(
  leaderAction: Action,
  followerAction: Action,
) {
  if (
    !updateEventNames.includes(leaderAction.name) ||
    !updateEventNames.includes(followerAction.name)
  ) {
    return false;
  }

  return leaderAction.name === followerAction.name;
}

export function getOrderIdFromMissionAction(action: Action) {
  if (!missionEventNames.includes(action.name)) {
    return null;
  }

  if (action.name === marketExecutedEventParser.eventName) {
    return marketExecutedEventParser.actionParser(action).args.orderId;
  } else {
    const event = limitExecutedEventParser.actionParser(action);

    if (
      [PendingOrderType.LIMIT_OPEN, PendingOrderType.STOP_OPEN].includes(
        event.args.orderType,
      )
    ) {
      return event.args.orderId;
    }

    return null;
  }
}

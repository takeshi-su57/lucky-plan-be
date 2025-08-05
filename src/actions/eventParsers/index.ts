import { leverageUpdateExecutedEventParser } from 'src/actions/eventParsers/leverage-update-executed.parser';
// import { leverageUpdateInitiatedEventParser } from 'src/actions/eventParsers/leverage-update-initiated.parser';
import { limitExecutedEventParser } from 'src/actions/eventParsers/limit-executed.parser';
import { marketCloseCanceledEventParser } from 'src/actions/eventParsers/market-close-canceled';
import { marketExecutedEventParser } from 'src/actions/eventParsers/market-executed.parser';
import { marketOpenCanceledEventParser } from 'src/actions/eventParsers/market-open-canceled';
import { marketOrderInitiatedEventParser } from 'src/actions/eventParsers/market-order-initiated.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-decrease-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-increase-executed.parser';

import { tradeMaxClosingSlippagePUpdatedEventParser } from 'src/actions/eventParsers/trade-max-closing-slippage-p-updated.parser';
import { tradePositivePnlWithdrawnEventParser } from 'src/actions/eventParsers/trade-positive-pnl-withdrawn.parser';

import { PendingOrderType, RegisteredEventType } from 'src/types';
import { Action, ActionItem } from '../entities/action.entity';

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
  tradePositivePnlWithdrawnEventParser,
  ...missionEventParsers,
  ...updateEventParsers,
  ...missionCanceledEventParsers,
];

export const registeredEventNames = eventParsers.map((item) => item.eventName);

export const eventParsersMap = Object.fromEntries(
  eventParsers.map((parser) => [parser.eventName, parser]),
);

export function eventToActionParser(
  contractId: number,
  event: RegisteredEventType,
): ActionItem {
  return eventParsersMap[event.eventName].logParser(contractId, event as any);
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

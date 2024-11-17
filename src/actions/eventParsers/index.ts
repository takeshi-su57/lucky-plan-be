import { leverageUpdateExecutedEventParser } from 'src/actions/eventParsers/leverage-update-executed.parser';
// import { leverageUpdateInitiatedEventParser } from 'src/actions/eventParsers/leverage-update-initiated.parser';
import { limitExecutedEventParser } from 'src/actions/eventParsers/limit-executed.parser';
import { marketCloseCanceledEventParser } from 'src/actions/eventParsers/market-close-canceled';
import { marketExecutedEventParser } from 'src/actions/eventParsers/market-executed.parser';
import { marketOpenCanceledEventParser } from 'src/actions/eventParsers/market-open-canceled';
import { marketOrderInitiatedEventParser } from 'src/actions/eventParsers/market-order-initiated.parser';
import { positionSizeDecreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-decrease-executed.parser';
import { positionSizeIncreaseExecutedEventParser } from 'src/actions/eventParsers/position-size-increase-executed.parser';
// import { positionSizeUpdateInitiatedEventParser } from 'src/actions/eventParsers/position-size-update-initiated.parser';
import { tradeCollateralUpdatedEventParser } from 'src/actions/eventParsers/trade-collateral-updated.parser';
import { tradeMaxClosingSlippagePUpdatedEventParser } from 'src/actions/eventParsers/trade-max-closing-slippage-p-updated.parser';
import { tradeSLUpdatedEventParser } from 'src/actions/eventParsers/trade-sl-updated.parser';
import { tradeTPUpdatedEventParser } from 'src/actions/eventParsers/trade-tp-updated.parser';
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
  tradeCollateralUpdatedEventParser,
  tradeSLUpdatedEventParser,
  tradeTPUpdatedEventParser,
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

// export const updateTrackEventParsers = [
//   leverageUpdateInitiatedEventParser,
//   positionSizeUpdateInitiatedEventParser,
// ];

export const eventParsers = [
  marketOrderInitiatedEventParser,
  ...missionEventParsers,
  ...updateEventParsers,
  ...missionCanceledEventParsers,
  // ...updateTrackEventParsers,
];

export const registeredEventNames = eventParsers.map((item) => item.eventName);

export const eventParsersMap = Object.fromEntries(
  eventParsers.map((parser) => [parser.eventName, parser]),
);

export function eventToActionParser(event: RegisteredEventType): ActionItem {
  return eventParsersMap[event.eventName].logParser(event as any);
}

export function isOpenMissionAction(action: Action) {
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

export function isCloseMissionAction(action: Action) {
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

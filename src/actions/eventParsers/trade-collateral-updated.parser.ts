import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'TradeCollateralUpdated';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradeCollateralUpdatedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type TradeCollateralUpdatedEventArgs =
  TradeCollateralUpdatedEvent['args'];

export function parseTradeCollateralUpdatedEvent(
  event: TradeCollateralUpdatedEvent,
) {
  return eventToAction(
    event.eventName,
    {
      address: event.args.user,
      index: event.args.index,
    },
    event.args,
  );
}

export const tradeCollateralUpdatedEventParser = {
  eventName,
  logParser: parseTradeCollateralUpdatedEvent,
  actionParser: actionToEvent<TradeCollateralUpdatedEventArgs>,
};

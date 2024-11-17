import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'TradeSlUpdated';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradeSlUpdatedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type TradeSlUpdatedEventArgs = TradeSlUpdatedEvent['args'];

export function parseTradeSlUpdatedEvent(event: TradeSlUpdatedEvent) {
  return eventToAction(
    event.eventName,
    {
      address: event.args.user,
      index: event.args.index,
    },
    event.args,
  );
}

export const tradeSLUpdatedEventParser = {
  eventName,
  logParser: parseTradeSlUpdatedEvent,
  actionParser: actionToEvent<TradeSlUpdatedEventArgs>,
};

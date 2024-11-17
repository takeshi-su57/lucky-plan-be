import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'TradeTpUpdated';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradeTpUpdatedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type TradeTpUpdatedEventArgs = TradeTpUpdatedEvent['args'];

export function parseTradeTpUpdatedEvent(event: TradeTpUpdatedEvent) {
  return eventToAction(
    event.eventName,
    {
      address: event.args.user,
      index: event.args.index,
    },
    event.args,
  );
}

export const tradeTPUpdatedEventParser = {
  eventName,
  logParser: parseTradeTpUpdatedEvent,
  actionParser: actionToEvent<TradeTpUpdatedEventArgs>,
};

import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'MarketCloseCanceled';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketCloseCanceledEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type MarketCloseCanceledEventArgs = MarketCloseCanceledEvent['args'];

export function parseMarketCloseCanceledEvent(event: MarketCloseCanceledEvent) {
  return eventToAction(
    event.eventName,
    {
      address: event.args.trader,
      index: Number(event.args.index),
    },
    event.args,
  );
}

export const marketCloseCanceledEventParser = {
  eventName,
  logParser: parseMarketCloseCanceledEvent,
  actionParser: actionToEvent<MarketCloseCanceledEventArgs>,
};

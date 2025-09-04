import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';

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
    getGnsPositionKey(event.args.trader, Number(event.args.index)), 
    event.args.trader,
    event.args,
  );
}

export const marketCloseCanceledEventParser = {
  eventName,
  logParser: parseMarketCloseCanceledEvent,
  actionParser: actionToEvent<MarketCloseCanceledEventArgs>,
};

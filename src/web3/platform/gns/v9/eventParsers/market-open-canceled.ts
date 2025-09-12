import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';
import { PerpTradeHistory } from 'src/web3/web3/types';

export const eventName = 'MarketOpenCanceled';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketOpenCanceledEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type MarketOpenCanceledEventArgs = MarketOpenCanceledEvent['args'];

export function parseMarketOpenCanceledEvent(event: MarketOpenCanceledEvent) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.orderId.user, event.args.orderId.index),
    event.args.orderId.user,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: MarketOpenCanceledEvent,
): PerpTradeHistory | null {
  return null;
}

export const marketOpenCanceledEventParser = {
  eventName,
  logParser: parseMarketOpenCanceledEvent,
  actionParser: actionToEvent<MarketOpenCanceledEventArgs>,
  eventToPerpTradeHistory,
};

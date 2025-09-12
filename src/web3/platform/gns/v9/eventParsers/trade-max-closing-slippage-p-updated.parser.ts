import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';
import { PerpTradeHistory } from 'src/web3/web3/types';

export const eventName = 'TradeMaxClosingSlippagePUpdated';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradeMaxClosingSlippagePUpdatedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type TradeMaxClosingSlippagePUpdatedEventArgs =
  TradeMaxClosingSlippagePUpdatedEvent['args'];

export function parseTradeMaxClosingSlippagePUpdatedEvent(
  event: TradeMaxClosingSlippagePUpdatedEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.user, event.args.index),
    event.args.user,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: TradeMaxClosingSlippagePUpdatedEvent,
): PerpTradeHistory | null {
  return null;
}

export const tradeMaxClosingSlippagePUpdatedEventParser = {
  eventName,
  logParser: parseTradeMaxClosingSlippagePUpdatedEvent,
  actionParser: actionToEvent<TradeMaxClosingSlippagePUpdatedEventArgs>,
  eventToPerpTradeHistory,
};

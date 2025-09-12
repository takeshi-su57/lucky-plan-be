import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';
import { getGnsPositionKey } from '../../utils';
import { PerpTradeHistory } from 'src/web3/web3/types';

export const eventName = 'TradePositivePnlWithdrawn';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type TradePositivePnlWithdrawnEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type TradePositivePnlWithdrawnEventArgs =
  TradePositivePnlWithdrawnEvent['args'];

export function parseTradePositivePnlWithdrawnEvent(
  event: TradePositivePnlWithdrawnEvent,
) {
  return eventToAction(
    event.eventName,
    getGnsPositionKey(event.args.trader, Number(event.args.index)),
    event.args.trader,
    event.args,
  );
}

export function eventToPerpTradeHistory(
  chainId: number,
  event: TradePositivePnlWithdrawnEvent,
): PerpTradeHistory | null {
  return null;
}

export const tradePositivePnlWithdrawnEventParser = {
  eventName,
  logParser: parseTradePositivePnlWithdrawnEvent,
  actionParser: actionToEvent<TradePositivePnlWithdrawnEventArgs>,
  eventToPerpTradeHistory,
};

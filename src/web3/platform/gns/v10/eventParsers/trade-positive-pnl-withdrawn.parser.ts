import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

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
  contractId: number,
  event: TradePositivePnlWithdrawnEvent,
) {
  return eventToAction(
    event.eventName,
    {
      contractId,
      address: event.args.trader,
      index: Number(event.args.index),
    },
    event.args,
  );
}

export const tradePositivePnlWithdrawnEventParser = {
  eventName,
  logParser: parseTradePositivePnlWithdrawnEvent,
  actionParser: actionToEvent<TradePositivePnlWithdrawnEventArgs>,
};

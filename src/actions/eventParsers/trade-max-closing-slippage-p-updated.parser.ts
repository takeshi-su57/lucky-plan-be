import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

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
  contractId: number,
  event: TradeMaxClosingSlippagePUpdatedEvent,
) {
  return eventToAction(
    event.eventName,
    {
      contractId,
      address: event.args.user,
      index: event.args.index,
    },
    event.args,
  );
}

export const tradeMaxClosingSlippagePUpdatedEventParser = {
  eventName,
  logParser: parseTradeMaxClosingSlippagePUpdatedEvent,
  actionParser: actionToEvent<TradeMaxClosingSlippagePUpdatedEventArgs>,
};

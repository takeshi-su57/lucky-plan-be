import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from '../abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'MarketOrderInitiated';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type MarketOrderInitiatedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type MarketOrderInitiatedEventArgs = MarketOrderInitiatedEvent['args'];

export function parseMarketOrderInitiatedEvent(
  contractId: number,
  event: MarketOrderInitiatedEvent,
) {
  return eventToAction(
    event.eventName,
    {
      contractId,
      address: event.args.orderId.user,
      index: event.args.orderId.index,
    },
    event.args,
  );
}

export const marketOrderInitiatedEventParser = {
  eventName,
  logParser: parseMarketOrderInitiatedEvent,
  actionParser: actionToEvent<MarketOrderInitiatedEventArgs>,
};

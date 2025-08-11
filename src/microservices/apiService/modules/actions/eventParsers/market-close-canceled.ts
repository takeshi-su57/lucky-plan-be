import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/microservices/web3Service/platform/gns/v9/abi/GNSMultiCollatDiamond';
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

export function parseMarketCloseCanceledEvent(
  contractId: number,
  event: MarketCloseCanceledEvent,
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

export const marketCloseCanceledEventParser = {
  eventName,
  logParser: parseMarketCloseCanceledEvent,
  actionParser: actionToEvent<MarketCloseCanceledEventArgs>,
};

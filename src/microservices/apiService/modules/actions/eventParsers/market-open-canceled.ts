import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/microservices/web3Service/platform/gns/v9/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

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

export function parseMarketOpenCanceledEvent(
  contractId: number,
  event: MarketOpenCanceledEvent,
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

export const marketOpenCanceledEventParser = {
  eventName,
  logParser: parseMarketOpenCanceledEvent,
  actionParser: actionToEvent<MarketOpenCanceledEventArgs>,
};

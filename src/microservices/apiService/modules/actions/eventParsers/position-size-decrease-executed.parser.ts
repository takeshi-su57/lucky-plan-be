import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/microservices/web3Service/platform/gns/v9/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'PositionSizeDecreaseExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type PositionSizeDecreaseExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type PositionSizeDecreaseExecutedEventArgs =
  PositionSizeDecreaseExecutedEvent['args'];

export function parsePositionSizeDecreaseExecutedEvent(
  contractId: number,
  event: PositionSizeDecreaseExecutedEvent,
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

export const positionSizeDecreaseExecutedEventParser = {
  eventName,
  logParser: parsePositionSizeDecreaseExecutedEvent,
  actionParser: actionToEvent<PositionSizeDecreaseExecutedEventArgs>,
};

import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'PositionSizeUpdateInitiated';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type PositionSizeUpdateInitiatedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type PositionSizeUpdateInitiatedEventArgs =
  PositionSizeUpdateInitiatedEvent['args'];

export function parsePositionSizeUpdateInitiatedEvent(
  event: PositionSizeUpdateInitiatedEvent,
) {
  return eventToAction(
    event.eventName,
    {
      address: event.args.orderId.user,
      index: event.args.orderId.index,
    },
    event.args,
  );
}

export const positionSizeUpdateInitiatedEventParser = {
  eventName,
  logParser: parsePositionSizeUpdateInitiatedEvent,
  actionParser: actionToEvent<PositionSizeUpdateInitiatedEventArgs>,
};

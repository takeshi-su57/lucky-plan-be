import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
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
  event: PositionSizeDecreaseExecutedEvent,
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

export const positionSizeDecreaseExecutedEventParser = {
  eventName,
  logParser: parsePositionSizeDecreaseExecutedEvent,
  actionParser: actionToEvent<PositionSizeDecreaseExecutedEventArgs>,
};

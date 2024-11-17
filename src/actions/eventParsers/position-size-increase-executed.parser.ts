import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'PositionSizeIncreaseExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type PositionSizeIncreaseExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type PositionSizeIncreaseExecutedEventArgs =
  PositionSizeIncreaseExecutedEvent['args'];

export function parsePositionSizeIncreaseExecutedEvent(
  event: PositionSizeIncreaseExecutedEvent,
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

export const positionSizeIncreaseExecutedEventParser = {
  eventName,
  logParser: parsePositionSizeIncreaseExecutedEvent,
  actionParser: actionToEvent<PositionSizeIncreaseExecutedEventArgs>,
};

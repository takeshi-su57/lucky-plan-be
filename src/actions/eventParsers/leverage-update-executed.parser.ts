import { DecodeEventLogReturnType, getAbiItem } from 'viem';
import { gnsMultiCollatDiamondAbi } from 'src/abi/GNSMultiCollatDiamond';
import { actionToEvent, eventToAction } from 'src/utils';

export const eventName = 'LeverageUpdateExecuted';

export const abiItem = getAbiItem({
  abi: gnsMultiCollatDiamondAbi,
  name: eventName,
});

export type LeverageUpdateExecutedEvent = DecodeEventLogReturnType<
  typeof gnsMultiCollatDiamondAbi,
  typeof eventName
>;
export type LeverageUpdateExecutedEventArgs =
  LeverageUpdateExecutedEvent['args'];

export function parseLeverageUpdateExecutedEvent(
  event: LeverageUpdateExecutedEvent,
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

export const leverageUpdateExecutedEventParser = {
  eventName,
  logParser: parseLeverageUpdateExecutedEvent,
  actionParser: actionToEvent<LeverageUpdateExecutedEventArgs>,
};
